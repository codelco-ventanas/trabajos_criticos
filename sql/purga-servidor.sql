-- ============================================================
-- OPCIONAL · Purga de permisos desde el servidor
--
-- La aplicación ya borra sola los permisos de los trabajos
-- terminados cada vez que alguien la tiene abierta. Para un
-- sistema de uso diario eso basta y no necesitas este archivo.
--
-- Instala esto sólo si quieres que la limpieza ocurra aunque
-- nadie abra la aplicación en varios días (vacaciones, paradas
-- de planta). Requiere pegar la clave service_role en la base
-- de datos, así que léelo completo antes de ejecutarlo.
-- ============================================================


-- ------------------------------------------------------------
-- PASO 1 · Extensiones
-- ------------------------------------------------------------
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;


-- ------------------------------------------------------------
-- PASO 2 · Guardar las credenciales en la bóveda
--
-- Reemplaza los dos valores. La clave service_role la encuentras
-- en Project Settings > API. Es la clave con permisos totales:
-- guárdala aquí y en ningún otro lugar, y NUNCA en config.js ni
-- en el repositorio de GitHub.
-- ------------------------------------------------------------
select vault.create_secret(
  'https://TU-PROYECTO.supabase.co',
  'url_proyecto',
  'URL del proyecto para la purga de permisos'
);

select vault.create_secret(
  'TU_CLAVE_SERVICE_ROLE',
  'clave_service_role',
  'Clave service_role usada sólo por la purga de permisos'
);


-- ------------------------------------------------------------
-- PASO 3 · La función de purga
--
-- Borra los archivos llamando a la API de Storage, no con SQL.
-- Esto es deliberado: un DELETE sobre storage.objects elimina
-- únicamente la ficha del archivo y deja el contenido huérfano
-- en el bucket, ocupando espacio de forma permanente y sin
-- manera de recuperarlo desde el panel.
-- ------------------------------------------------------------
create or replace function public.purga_permisos_vencidos(horas_gracia int default 0)
returns integer
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  base    text;
  clave   text;
  corte   timestamptz := now() - make_interval(hours => horas_gracia);
  fila    record;
  total   integer := 0;
begin
  select decrypted_secret into base
    from vault.decrypted_secrets where name = 'url_proyecto';
  select decrypted_secret into clave
    from vault.decrypted_secrets where name = 'clave_service_role';

  if base is null or clave is null then
    raise exception 'Faltan las credenciales en la bóveda. Revisa el paso 2.';
  end if;

  for fila in
    select id, permiso_path
      from public.trabajos
     where permiso_path is not null
       and permiso_path not like 'ejemplo/%'
       and (termino < corte or (cerrado and cerrado_en < corte))
     limit 200
  loop
    perform net.http_delete(
      url     := base || '/storage/v1/object/permisos/' || fila.permiso_path,
      headers := jsonb_build_object(
                   'Authorization', 'Bearer ' || clave,
                   'apikey', clave)
    );

    update public.trabajos
       set permiso_path = null,
           permiso_tipo = null,
           permiso_purgado_en = now()
     where id = fila.id;

    total := total + 1;
  end loop;

  return total;
end;
$$;

revoke all on function public.purga_permisos_vencidos(int) from anon, authenticated;


-- ------------------------------------------------------------
-- PASO 4 · Programar la ejecución
--
-- Todos los días a las 03:00 (hora del servidor, que es UTC:
-- equivale a las 23:00 o 00:00 en Chile según la época del año).
-- ------------------------------------------------------------
select cron.schedule(
  'purga-permisos-trabajos',
  '0 3 * * *',
  $$ select public.purga_permisos_vencidos(0); $$
);


-- ------------------------------------------------------------
-- Comprobar y administrar
-- ------------------------------------------------------------

-- Ejecutar la purga ahora mismo, para probar:
--   select public.purga_permisos_vencidos(0);

-- Ver las tareas programadas:
--   select jobid, jobname, schedule, active from cron.job;

-- Ver cómo terminaron las últimas ejecuciones:
--   select * from cron.job_run_details order by start_time desc limit 10;

-- Desactivar la purga automática:
--   select cron.unschedule('purga-permisos-trabajos');
