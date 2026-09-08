-- ============================================================
-- MIGRACIÓN · Purga automática de permisos de trabajo
--
-- Ejecuta este archivo SÓLO si ya habías corrido la versión
-- anterior de sql/schema.sql en tu proyecto de Supabase.
--
-- Si vas a crear el proyecto desde cero, no lo necesitas:
-- schema.sql ya incluye todo esto.
--
-- Supabase > SQL Editor > New query > pegar > Run
-- ============================================================

-- 1. El permiso deja de ser obligatorio a nivel de columna, porque el
--    archivo se elimina cuando el trabajo termina. Sigue siendo
--    obligatorio al registrar, ahora mediante un trigger.
alter table public.trabajos alter column permiso_path drop not null;
alter table public.trabajos add column if not exists permiso_purgado_en timestamptz;

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


-- 2. La auditoría ignora las purgas: son mantención automática, no
--    una acción de una persona.
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
    if new.permiso_purgado_en is distinct from old.permiso_purgado_en
       and new.permiso_path is null then
      return new;
    end if;

    antes   := to_jsonb(old);
    despues := to_jsonb(new);
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


-- 3. Permiso para que la aplicación pueda borrar archivos del bucket.
drop policy if exists permisos_borrar on storage.objects;
create policy permisos_borrar on storage.objects
  for delete to anon, authenticated
  using (bucket_id = 'permisos');


-- 4. Vista con el estado actualizada (incluye las columnas nuevas).
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

grant select on public.trabajos_estado to anon, authenticated;

-- ============================================================
-- Listo. La aplicación empezará a purgar los permisos de los
-- trabajos terminados la próxima vez que alguien la abra.
-- ============================================================
