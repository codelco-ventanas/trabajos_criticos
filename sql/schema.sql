-- ============================================================
-- Trabajos Críticos · Codelco División Ventanas
-- Esquema completo para Supabase (PostgreSQL)
-- Ejecutar de una sola vez en: Supabase > SQL Editor > New query
-- ============================================================

-- ------------------------------------------------------------
-- 1. TABLA PRINCIPAL
-- ------------------------------------------------------------
create table if not exists public.trabajos (
  id              uuid primary key default gen_random_uuid(),

  -- Identificación
  tipo            text not null check (tipo in ('caliente','altura','confinado')),
  empresa         text not null check (length(trim(empresa)) > 0),
  area            text not null check (length(trim(area)) > 0),
  equipo          text not null check (length(trim(equipo)) > 0),
  descripcion     text not null check (length(trim(descripcion)) > 0),

  -- Personal
  n_trabajadores  integer not null check (n_trabajadores > 0 and n_trabajadores <= 999),
  supervisor      text not null check (length(trim(supervisor)) > 0),

  -- Vigencia (siempre en UTC; la app convierte a America/Santiago)
  inicio          timestamptz not null,
  termino         timestamptz not null,

  -- Ubicación en el plano: coordenadas normalizadas 0..1
  -- x = 0 borde izquierdo, x = 1 borde derecho
  -- y = 0 borde superior, y = 1 borde inferior
  x               double precision not null check (x >= 0 and x <= 1),
  y               double precision not null check (y >= 0 and y <= 1),
  mapa_version    text not null default 'ventanas-aerea-2024',

  -- Permiso de trabajo (ruta dentro del bucket 'permisos')
  -- Es obligatorio al registrar (lo exige el trigger de más abajo),
  -- pero queda en NULL cuando el archivo se purga al terminar el
  -- trabajo. Así el registro conserva la constancia sin el archivo.
  permiso_path       text check (length(trim(permiso_path)) > 0),
  permiso_tipo       text,
  permiso_purgado_en timestamptz,

  -- Ciclo de vida manual. El estado operativo (PROGRAMADO / ACTIVO /
  -- FINALIZADO) NO se guarda: se deriva de inicio/termino. Este campo
  -- sólo marca cierres anticipados o anulaciones hechas por un admin.
  cerrado         boolean not null default false,
  cerrado_en      timestamptz,
  cerrado_motivo  text,

  -- Trazabilidad
  registrado_por  text not null default 'No identificado',
  creado_en       timestamptz not null default now(),
  modificado_por  text,
  modificado_en   timestamptz,

  constraint termino_posterior check (termino > inicio)
);

comment on table public.trabajos is
  'Trabajos críticos registrados sobre el plano de la División Ventanas.';
comment on column public.trabajos.x is
  'Coordenada horizontal normalizada 0..1 respecto del ancho de la imagen base.';
comment on column public.trabajos.y is
  'Coordenada vertical normalizada 0..1 respecto del alto de la imagen base.';

-- Índices para el mapa activo y el historial
create index if not exists trabajos_vigencia_idx on public.trabajos (termino desc, inicio);
create index if not exists trabajos_creado_idx   on public.trabajos (creado_en desc);
create index if not exists trabajos_tipo_idx     on public.trabajos (tipo);
create index if not exists trabajos_empresa_idx  on public.trabajos (lower(empresa));
create index if not exists trabajos_area_idx     on public.trabajos (lower(area));


-- ------------------------------------------------------------
-- 2. REGLA DE VIGENCIA DEL PERMISO (turnos de 12 horas)
--
--    Inicio 08:00–19:59  ->  término máximo 19:59 del mismo día
--    Inicio 20:00–07:59  ->  término máximo 07:59 (cruzando medianoche
--                            si el inicio fue 20:00 o posterior)
--
--    Se valida en el servidor para que ningún cliente pueda saltarse
--    la restricción, aunque manipule el navegador.
-- ------------------------------------------------------------
create or replace function public.valida_ventana_permiso()
returns trigger
language plpgsql
as $$
declare
  ini_local  timestamp;      -- inicio en hora de Chile
  fin_local  timestamp;      -- término en hora de Chile
  hora_ini   integer;
  limite     timestamp;      -- término máximo permitido
begin
  ini_local := new.inicio at time zone 'America/Santiago';
  fin_local := new.termino at time zone 'America/Santiago';
  hora_ini  := extract(hour from ini_local);

  if hora_ini >= 8 and hora_ini < 20 then
    -- Turno día: cierra a las 19:59 del mismo día
    limite := date_trunc('day', ini_local) + interval '19 hours 59 minutes';
  elsif hora_ini >= 20 then
    -- Turno noche que parte antes de medianoche: cierra 07:59 del día siguiente
    limite := date_trunc('day', ini_local) + interval '1 day 7 hours 59 minutes';
  else
    -- Turno noche ya pasada la medianoche: cierra 07:59 del mismo día
    limite := date_trunc('day', ini_local) + interval '7 hours 59 minutes';
  end if;

  if fin_local > limite then
    raise exception
      'La hora de término excede el turno. Con inicio a las %, el término máximo es % (hora de Chile).',
      to_char(ini_local, 'HH24:MI'), to_char(limite, 'DD-MM-YYYY HH24:MI');
  end if;

  if new.termino - new.inicio > interval '12 hours' then
    raise exception 'Un permiso de trabajo no puede superar 12 horas de duración.';
  end if;

  return new;
end;
$$;

-- El permiso es obligatorio para registrar un trabajo nuevo. No se usa
-- NOT NULL en la columna porque el archivo se elimina al finalizar.
create or replace function public.exige_permiso()
returns trigger language plpgsql as $$
begin
  if new.permiso_path is null or length(trim(new.permiso_path)) = 0 then
    raise exception 'Debes adjuntar el permiso de trabajo para registrar la actividad.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_exige_permiso on public.trabajos;
create trigger trg_exige_permiso
  before insert on public.trabajos
  for each row execute function public.exige_permiso();

drop trigger if exists trg_valida_ventana on public.trabajos;
create trigger trg_valida_ventana
  before insert or update of inicio, termino on public.trabajos
  for each row execute function public.valida_ventana_permiso();


-- ------------------------------------------------------------
-- 3. AUDITORÍA
--    Registra automáticamente cada alta, cambio y cierre.
-- ------------------------------------------------------------
create table if not exists public.auditoria (
  id           bigserial primary key,
  trabajo_id   uuid,
  accion       text not null check (accion in ('crear','editar','cerrar','eliminar')),
  actor        text not null default 'No identificado',
  cambios      jsonb,
  registrado_en timestamptz not null default now()
);

create index if not exists auditoria_trabajo_idx on public.auditoria (trabajo_id, registrado_en desc);
create index if not exists auditoria_fecha_idx   on public.auditoria (registrado_en desc);

create or replace function public.registra_auditoria()
returns trigger
language plpgsql
as $$
declare
  campos    jsonb := '{}'::jsonb;
  clave     text;
  antes     jsonb;
  despues   jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.auditoria (trabajo_id, accion, actor, cambios)
    values (new.id, 'crear', coalesce(new.registrado_por,'No identificado'),
            jsonb_build_object('tipo', new.tipo, 'empresa', new.empresa,
                               'area', new.area, 'equipo', new.equipo));
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- La purga del permiso es mantención automática, no una acción de
    -- una persona: no ensucia la trazabilidad.
    if new.permiso_purgado_en is distinct from old.permiso_purgado_en
       and new.permiso_path is null then
      return new;
    end if;

    antes   := to_jsonb(old);
    despues := to_jsonb(new);
    -- Compara campo por campo y guarda sólo lo que cambió
    for clave in select jsonb_object_keys(despues) loop
      if clave not in ('modificado_en','modificado_por')
         and antes->clave is distinct from despues->clave then
        campos := campos || jsonb_build_object(
          clave, jsonb_build_object('antes', antes->clave, 'despues', despues->clave));
      end if;
    end loop;

    if campos <> '{}'::jsonb then
      insert into public.auditoria (trabajo_id, accion, actor, cambios)
      values (new.id,
              case when new.cerrado and not old.cerrado then 'cerrar' else 'editar' end,
              coalesce(new.modificado_por,'No identificado'),
              campos);
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.auditoria (trabajo_id, accion, actor, cambios)
    values (old.id, 'eliminar', 'Administrador',
            jsonb_build_object('tipo', old.tipo, 'empresa', old.empresa,
                               'area', old.area, 'equipo', old.equipo,
                               'permiso_path', old.permiso_path));
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_auditoria on public.trabajos;
create trigger trg_auditoria
  after insert or update or delete on public.trabajos
  for each row execute function public.registra_auditoria();


-- ------------------------------------------------------------
-- 4. VISTA CON ESTADO CALCULADO
--    El estado nunca se almacena: se deriva del reloj del servidor.
--    Por eso el sistema sigue siendo correcto aunque nadie tenga la
--    aplicación abierta, se reinicie el computador o se cierre el
--    navegador. No hace falta ningún proceso programado.
-- ------------------------------------------------------------
create or replace view public.trabajos_estado as
select
  t.*,
  case
    when t.cerrado          then 'FINALIZADO'
    when now() <  t.inicio  then 'PROGRAMADO'
    when now() >= t.termino then 'FINALIZADO'
    else 'ACTIVO'
  end as estado
from public.trabajos t;


-- ------------------------------------------------------------
-- 5. SEGURIDAD (RLS)
--
--    Decisión tomada en el levantamiento: la aplicación no tiene
--    inicio de sesión. Cualquiera con la URL puede ver y crear.
--    Editar y eliminar se controla en la interfaz con una clave.
--
--    IMPORTANTE: al no haber sesión, la base de datos no puede
--    distinguir a un administrador de un usuario común, de modo que
--    las políticas de update/delete quedan abiertas al rol anónimo.
--    Si más adelante quieres que la restricción la aplique el
--    servidor, revisa la sección "Endurecer la seguridad" del README.
-- ------------------------------------------------------------
alter table public.trabajos  enable row level security;
alter table public.auditoria enable row level security;

drop policy if exists trabajos_lectura   on public.trabajos;
drop policy if exists trabajos_creacion  on public.trabajos;
drop policy if exists trabajos_edicion   on public.trabajos;
drop policy if exists trabajos_borrado   on public.trabajos;

create policy trabajos_lectura  on public.trabajos for select using (true);
create policy trabajos_creacion on public.trabajos for insert with check (true);
create policy trabajos_edicion  on public.trabajos for update using (true) with check (true);
create policy trabajos_borrado  on public.trabajos for delete using (true);

-- La auditoría se puede leer y escribir, pero nunca modificar ni borrar:
-- así el historial de cambios no se puede alterar desde el navegador.
drop policy if exists auditoria_lectura  on public.auditoria;
drop policy if exists auditoria_registro on public.auditoria;

create policy auditoria_lectura  on public.auditoria for select using (true);
create policy auditoria_registro on public.auditoria for insert with check (true);

-- Permisos explícitos de PostgREST.
-- Desde el 30 de mayo de 2026 los proyectos nuevos de Supabase exigen
-- otorgar estos permisos a mano; sin ellos la API devuelve error aunque
-- las políticas RLS estén bien escritas.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.trabajos  to anon, authenticated;
grant select, insert                 on public.auditoria to anon, authenticated;
grant usage, select on sequence public.auditoria_id_seq  to anon, authenticated;
grant select on public.trabajos_estado to anon, authenticated;


-- ------------------------------------------------------------
-- 6. TIEMPO REAL
--    Publica la tabla para que los cambios lleguen solos a todos
--    los navegadores conectados, sin recargar la página.
-- ------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.trabajos;
exception
  when duplicate_object then null;   -- ya estaba publicada
end $$;


-- ------------------------------------------------------------
-- 7. ALMACENAMIENTO DE PERMISOS DE TRABAJO
--    Bucket privado. Los archivos se abren mediante enlaces firmados
--    con vencimiento, no por URL pública, porque el permiso suele
--    contener nombres y RUT de trabajadores.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('permisos', 'permisos', false, 10485760,
        array['image/jpeg','image/png','application/pdf'])
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public             = false;

drop policy if exists permisos_subir on storage.objects;
drop policy if exists permisos_leer  on storage.objects;

create policy permisos_subir on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'permisos');

create policy permisos_leer on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'permisos');

-- Necesaria para que la aplicación pueda eliminar los permisos de los
-- trabajos ya terminados.
drop policy if exists permisos_borrar on storage.objects;
create policy permisos_borrar on storage.objects
  for delete to anon, authenticated
  using (bucket_id = 'permisos');


-- ============================================================
-- Fin del esquema
-- ============================================================
