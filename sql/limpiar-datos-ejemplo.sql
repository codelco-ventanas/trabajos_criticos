-- ============================================================
-- Dejar el mapa en cero
--
-- Ejecuta esto en Supabase > SQL Editor si todavía ves los tres
-- trabajos de ejemplo (Montajes Industriales Aconcagua,
-- Servicios Técnicos Puchuncaví y Mantención Costa Norte).
--
-- Sólo borra esos registros de demostración. Los trabajos reales
-- que hayas registrado tú no se tocan.
-- ============================================================

delete from public.trabajos where registrado_por = 'Datos de ejemplo';


-- ------------------------------------------------------------
-- Si además quieres partir completamente de cero, borrando TODOS
-- los trabajos registrados hasta ahora (incluidas tus pruebas),
-- quita los dos guiones del inicio de estas dos líneas:
-- ------------------------------------------------------------
-- delete from public.trabajos;
-- delete from public.auditoria;

-- Comprobar cuántos quedan:
--   select count(*) from public.trabajos;
