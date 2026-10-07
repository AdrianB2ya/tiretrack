# Poner TireTrack en producción

Esta guía va de cero a la primera empresa usando la app. Lo que el código
puede hacer solo ya está hecho. Lo que falta son **cuentas y decisiones que
son tuyas**: dónde corre el servidor, la base de datos, el dominio, el bucket
de fotos y la cuenta de Expo.

Orden: base → fotos → servidor → primera empresa → app. Cada paso termina en
una comprobación. No pases al siguiente si la del anterior no da lo esperado.

---

## 0. Lo que hay que tener

| Qué | Para qué | Opciones |
|---|---|---|
| **PostgreSQL 16** gestionado | Los datos. Debe permitir crear roles | Supabase, Neon, Railway, DigitalOcean, RDS… |
| **Un servidor Node 20** | La API | Railway, Render, Fly.io, un VPS con systemd o Docker |
| **Dominio con HTTPS** | La app habla con `https://api.tudominio.com` | Lo da el proveedor, o Cloudflare delante de un VPS |
| **Cloudflare R2** | Las fotos | Cuenta de Cloudflare, plan gratuito para empezar |
| **Cuenta de Expo** | Compilar el APK | expo.dev, gratis |

**HTTPS es obligatorio.** Android bloquea `http://` en apps de producción, y
el token de sesión viajaría en claro.

---

## 1. Base de datos

### 1.1 Crear la base y aplicar las migraciones

Con la conexión del **dueño**, el usuario que te da el proveedor:

```bash
cd apps/api
DIRECT_URL="postgresql://dueno:clave@host:5432/tiretrack" \
DATABASE_URL="postgresql://dueno:clave@host:5432/tiretrack" \
npx prisma migrate deploy
```

Las migraciones crean las tablas, las restricciones (`manual.sql`), las
políticas de aislamiento (`rls.sql`) y los dos roles: `tiretrack_app` y
`tiretrack_auth`. Los roles nacen **sin poder entrar**.

Con un pooler (Supabase, Neon), `DIRECT_URL` debe ser la conexión directa,
no la del pooler. Las migraciones no funcionan a través de él.

### 1.2 Darles contraseña a los dos roles

En la consola SQL del proveedor, con **dos contraseñas largas y distintas**:

```sql
ALTER ROLE tiretrack_app  LOGIN PASSWORD '…clave larga 1…';
ALTER ROLE tiretrack_auth LOGIN PASSWORD '…clave larga 2…';
```

La API **nunca** entra como dueño: el dueño se salta el aislamiento entre
empresas. En producción el servidor se niega a arrancar si las dos
conexiones usan el mismo usuario.

### Comprobación

```sql
SELECT relname FROM pg_class
 WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace
   AND NOT relforcerowsecurity AND relname <> '_prisma_migrations';
```

Debe dar **cero filas**: todas las tablas tienen el aislamiento forzado.

---

## 2. Fotos en Cloudflare R2

1. En Cloudflare: **R2 → Crear bucket**, por ejemplo `tiretrack-fotos`.
   Déjalo **privado**: las fotos se entregan con URL temporal firmada.
2. **R2 → Administrar tokens de API → Crear token** con permiso de
   *lectura y escritura de objetos*, solo para ese bucket.
3. Anota:
   - `S3_ENDPOINT` = `https://<id-de-cuenta>.r2.cloudflarestorage.com`
   - `S3_ACCESS_KEY_ID`
   - `S3_SECRET_ACCESS_KEY`
   - `S3_BUCKET` = `tiretrack-fotos`

No hace falta configurar CORS: el teléfono sube con una petición nativa, no
desde un navegador.

---

## 3. Servidor

### 3.1 Variables de entorno

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | El que pida el proveedor (muchos lo inyectan solos) |
| `DATABASE_URL` | `postgresql://tiretrack_app:<clave 1>@host:5432/tiretrack` |
| `DATABASE_URL_AUTH` | `postgresql://tiretrack_auth:<clave 2>@host:5432/tiretrack` |
| `JWT_SECRET` | 48 caracteres o más, al azar. Ver abajo |
| `ALMACENAMIENTO` | `r2` |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Los del paso 2 |
| `S3_REGION` | `auto` |
| `TRABAJOS_CADA_MINUTOS` | `15` (cierre tácito y visitas recurrentes) |

Para generar el secreto:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**El secreto es la llave de todas las empresas**: con él se fabrican sesiones
de cualquiera. Va solo en las variables del proveedor, nunca en el
repositorio ni en un chat. Si se filtra, se cambia, y todos vuelven a
ingresar.

El servidor **valida toda la configuración al arrancar** y lista todos los
problemas juntos. Si algo falta, no arranca y dice qué.

### 3.2 Instalar y arrancar

```bash
npm ci                         # con las dependencias de desarrollo: hacen falta tsx y prisma
cd apps/api
node --import tsx src/server.ts
```

El proveedor debe reiniciar el proceso si se cae, y enviarle `SIGTERM` al
apagar: el servidor termina lo que está en curso antes de cerrar.

Hay dos chequeos, y conviene configurarlos los dos:

- `GET /salud` responde 200 si el proceso vive. Úsalo para reiniciar.
- `GET /listo` responde 200 si las dos conexiones a la base funcionan, o 503
  si no. Úsalo para mandar tráfico. **No** lo uses para reiniciar: un corte de
  la base reiniciaría el proceso en bucle sin arreglar nada.

### Comprobación

```bash
curl https://api.tudominio.com/listo     # {"estado":"listo"}
```

A los pocos minutos, el registro del servidor debe mostrar la vuelta de los
trabajos programados **con empresas procesadas**. Si dice cero empresas
cuando ya hay una creada (paso 4), es la política `trabajos_dueno` de
`rls.sql`: en local el dueño es superusuario y no la ejercita. Avísame con el
registro.

---

## 4. La primera empresa

La semilla (`npm run seed`) es **de demostración**: trae clientes inventados
y usuarios con contraseñas conocidas. **No se corre en producción.**

Para crear la empresa real, escribe un `empresa.json`. No lo subas al
repositorio, porque lleva la cédula del administrador:

```json
{
  "empresa": { "nombre": "Asistectire S.A.S.", "nit": "901.234.567-8" },
  "sede": { "nombre": "Fundación", "codigo": "FUN", "ciudad": "Fundación" },
  "administrador": {
    "nombre": "Nombre Apellido",
    "cedula": "1234567890",
    "email": "admin@asistectire.com",
    "telefono": "3001234567"
  }
}
```

El código de la sede (`FUN`) entra en los folios: `OS-FUN-000001`.

Córrelo desde una máquina que alcance la base:

```bash
cd apps/api
DIRECT_URL="postgresql://dueno:…" \
DATABASE_URL_AUTH="postgresql://tiretrack_auth:…" \
JWT_SECRET="…el mismo del servidor…" \
node --import tsx src/herramientas/crear-empresa.ts empresa.json
```

El script crea la empresa, la sede, los servicios del catálogo y el
administrador, todo en una transacción. Al final muestra **una sola vez** el
código de activación del administrador, que vence en 72 horas.

El administrador:

1. instala la app (paso 5),
2. toca **"Tengo un código de activación"**,
3. elige su contraseña y registra una app autenticadora (Google
   Authenticator, Microsoft Authenticator…). Para el administrador el doble
   factor es obligatorio.

Desde ahí crea en la app las demás sedes, los usuarios (cada uno recibe su
código por WhatsApp), las plantillas de ejes, los clientes y los vehículos.

---

## 5. La app

Sigue [`apps/mobile/COMPILAR.md`](apps/mobile/COMPILAR.md) con una sola
diferencia: en el perfil que vayas a compilar de `eas.json`, la URL del
servidor es la de producción.

```
EXPO_PUBLIC_API_URL=https://api.tudominio.com/api/v1
```

El perfil `campo` produce un APK que se instala directo, sin tienda.

---

## 6. Lista de comprobación del primer día

En el teléfono, con usuarios reales:

- [ ] El administrador activa su cuenta con el código y entra con doble factor.
- [ ] Crea un coordinador y un técnico. Cada uno activa con su código.
- [ ] Crea una plantilla de ejes, un cliente con su sede y un vehículo.
- [ ] El coordinador programa una orden para el técnico.
- [ ] El técnico la ve, **apaga los datos**, captura dos posiciones con foto,
      kilometraje y firma, y la envía a revisión. Después enciende los datos.
- [ ] Las fotos llegan: en Cloudflare, el bucket tiene archivos bajo el id
      de la empresa.
- [ ] El coordinador ve la orden en "Revisar", ve las fotos y la aprueba.
- [ ] El PDF de la orden se descarga y se puede compartir.
- [ ] En "Auditoría" (administrador) aparece la descarga del PDF.

## 7. Copias de seguridad

- **Base:** activa las copias automáticas del proveedor con
  restauración a un punto en el tiempo, si la ofrece. Antes de dar la app a
  los técnicos, **prueba una restauración** en una base aparte.
- **Fotos:** R2 no versiona por defecto. Las fotos son evidencia del
  servicio: si el plan lo permite, activa una regla de retención o copia el
  bucket periódicamente.

## Lo que todavía no está

- **Suplantación del superadmin** (soporte entrando a una empresa, con
  motivo, ticket y vencimiento). Se decidió construirla antes de tener una
  segunda empresa o dar soporte real. Mientras tanto, el soporte se da con
  la cuenta del administrador de la empresa.
- **iOS:** necesita una cuenta de desarrollador de Apple.
