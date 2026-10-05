# Generar el APK y probarlo en un teléfono

Esta parte **no se puede hacer en el entorno donde se construyó el proyecto**:
compilar requiere los servicios de Expo, que necesitan una cuenta y salida a
internet. Todo lo demás ya está listo; aquí quedan los pasos exactos.

Importa hacerlo pronto: **nada de la app se ha ejecutado nunca en un
teléfono**. La cámara, el almacenamiento seguro, SQLite y el tamaño de los
botones están validados con adaptadores en Node, no con hardware. Las pruebas
dicen que la lógica es correcta; no dicen que la app abra.

---

## 1. Crear el proyecto en EAS

```bash
npm install -g eas-cli
eas login
cd apps/mobile
eas init          # crea el proyecto y escribe el projectId
```

`eas init` reemplaza el valor de `extra.eas.projectId` en `app.json`, que hoy
dice `COMPLETAR-AL-CREAR-EL-PROYECTO-EN-EAS`.

## 2. Apuntar la app a un servidor alcanzable

El perfil `campo` de `eas.json` usa `http://10.0.2.2:4000`, que es como el
**emulador de Android** llama al `localhost` de la máquina. Un teléfono real
no lo alcanza: hay que poner una dirección que el teléfono vea.

- En la misma red wifi: la IP del computador, por ejemplo
  `http://192.168.1.50:4000/api/v1`.
- Un servidor de pruebas desplegado: usa el perfil `pruebas`.

```bash
# Editar el env del perfil en eas.json, o pasarlo al compilar:
EXPO_PUBLIC_API_URL=http://192.168.1.50:4000/api/v1 eas build -p android --profile campo
```

El servidor debe escuchar en `0.0.0.0` (ya lo hace) y el cortafuegos permitir
el puerto.

## 3. Compilar

```bash
eas build -p android --profile campo
```

Tarda unos minutos y entrega un enlace de descarga. El perfil `campo` produce
un **APK** instalable directamente; el de producción produce un paquete para
la tienda.

## 4. Preparar la base antes de entrar

La app no sirve sin datos. En el servidor:

```bash
cd apps/api
npx prisma migrate deploy
psql "$DATABASE_URL" -f prisma/rls.sql   # roles y aislamiento por empresa
npx tsx prisma/seed.ts                    # empresa, sede, usuarios, catálogo
```

El `rls.sql` crea los dos roles. **La conexión de acceso
(`DATABASE_URL_AUTH`) debe usar `tiretrack_auth`**, o el login no verá ningún
usuario: el arranque lo rechaza en producción si ambas URL usan el mismo
usuario.

## 5. Qué revisar en el teléfono

Esto es lo que las pruebas **no** pueden decir. En orden:

1. **Que abra.** Un fallo aquí suele ser una migración de SQLite; la pantalla
   de arranque muestra el mensaje en vez de quedarse en blanco.
2. **Ingresar.** Necesita señal la primera vez; la pantalla lo advierte.
3. **Que lleguen las órdenes.** Si la lista sale vacía, el problema está en la
   descarga: revisar que el técnico tenga órdenes asignadas y que la URL del
   servidor sea alcanzable desde el teléfono.
4. **Capturar una posición con guantes puestos.** Es la razón de los tamaños
   táctiles y del contraste; nunca se ha probado con una mano real.
5. **Tomar una foto** y ver que baje de 4 MB a unos 200 KB.
6. **Poner el teléfono en modo avión** y capturar una orden completa. Al
   volver la señal, todo debe subir solo y la firma quedar vigente.
7. **Leer la pantalla bajo el sol.** Los estados se muestran en texto además
   de color justo por esto, pero hay que confirmarlo afuera.

## 6. Lo que seguramente aparecerá

Cosas que un entorno sin hardware no puede anticipar, y dónde mirar:

| Síntoma | Dónde mirar |
|---|---|
| La app cierra al abrir | `Arranque.tsx`: la migración de SQLite |
| La cámara no pide permiso | Los textos de permiso en `app.json` (plugin `expo-image-picker`) |
| Ingresa pero la lista sale vacía | La descarga: `GET /sincronizacion` y las órdenes asignadas |
| Las fotos no suben | La URL firmada y el acceso al almacenamiento S3/R2 |
| Todo se queda "sin enviar" | La URL del servidor desde el teléfono, no desde el computador |
