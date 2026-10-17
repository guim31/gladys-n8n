# n8n

[n8n](https://n8n.io/) es una herramienta de automatización de workflows que
puede alojar usted mismo: nodos enlazados recogen datos, llaman a servicios,
envían mensajes. Esta integración trae sus workflows de n8n a Gladys: cada
workflow se convierte en un dispositivo con su estado (activo o no, última
ejecución correcta o fallida, fallos de las últimas 24 horas), las escenas
pueden **iniciar un workflow** mediante su nodo Webhook y usar su respuesta,
reaccionar cuando **cualquier** ejecución falla o cuando n8n deja de responder,
y un widget del panel muestra primero los workflows con error.

Probada con un n8n 2.43 real autoalojado (Docker); no con n8n Cloud (misma
API, sin probar): sus comentarios son bienvenidos en
[las issues](https://github.com/guim31/gladys-n8n/issues).

## Lo que necesita

- Gladys Assistant 5.1.0 o posterior.
- n8n 1.x o 2.x, autoalojado, accesible desde la máquina de Gladys (n8n Cloud
  también debería funcionar: misma API).
- Una clave de API de n8n (Settings → n8n API). La API pública no debe estar
  desactivada (`N8N_PUBLIC_API_DISABLED`).

En cada actualización (cada minuto por defecto), la integración envía cuatro
peticiones a la API de n8n, y algunas más la primera vez. n8n no limita su
API; en n8n Cloud, compruebe los límites de su plan.

## Primeros pasos

### 1. Crear una clave de API

En n8n, abra **Settings → n8n API**, pulse **Create an API key**, póngale un
nombre (`Gladys`) y ninguna caducidad, y copie la clave: n8n solo la muestra
una vez. Si su n8n permite elegir los permisos (scopes) de la clave, marque
`workflow:list`, `workflow:activate`, `workflow:deactivate`, `execution:list`
y `execution:read`. La clave ve los workflows de su propietario.

### 2. Configurar la integración

En Gladys, abra la configuración de la integración n8n:

- **Dirección de n8n**: la dirección con la que abre n8n, por ejemplo
  `http://192.168.1.2:5678`. A una dirección IP sola se le añade el puerto 5678. También sirve una URL copiada del navegador.
- **Clave de API**: la clave del paso 1.
- **Intervalo de actualización**: de 30 segundos a 5 minutos.
- **Permitir activar workflows desde Gladys**: desactivado por defecto, vea
  más abajo.
- **Idioma de los nombres**: idioma de los nombres de las funciones, de los
  estados y de los resultados de escena.

Pulse **Probar la conexión**: muestra los workflows, los activos y los fallos
de las últimas 24 horas.

### 3. Añadir los workflows

Abra la pestaña **Descubrir** de la integración y añada los workflows que
quiera seguir, y el dispositivo **n8n** si quiere las cifras de toda la
instancia. No se añade nada sin usted. Los disparadores de escena funcionan
para todos los workflows, añadidos o no.

## Los dispositivos

Cada workflow (salvo los archivados) da un dispositivo:

| Función                         | Valor                                                                |
| ------------------------------- | -------------------------------------------------------------------- |
| Activo                          | el workflow está activo (publicado) o no                             |
| Última ejecución                | Correcto, Fallido, Bloqueado, Cancelado, En espera, En ejecución…    |
| Funciona                        | No si la última ejecución falló, Sí en caso contrario (verde / rojo) |
| Fallos en 24 h                  | ejecuciones fallidas de las últimas 24 horas                         |
| Último inicio                   | comienzo de la última ejecución, día/mes horas:minutos               |
| Duración de la última ejecución | en segundos                                                          |

El interruptor **Activo** solo muestra el estado por defecto. Con **Permitir
activar workflows desde Gladys**, activa y desactiva el workflow: pulse
**Actualizar** en los dispositivos de la pestaña Descubrir después de cambiar
la opción.

El dispositivo **n8n** da los **Workflows activos**, los **Fallos en 24 h** y
los **Workflows en total**.

## Panel

El widget **Workflows de n8n** muestra tres mosaicos (workflows activos,
fallos en 24 horas, ejecuciones en curso), y luego una fila por workflow:
primero los que tienen error, luego los que están en curso y después los
demás, con el estado de la última ejecución, su hora de inicio y los fallos del
día. Por defecto lista los workflows activos; elija otros en sus ajustes
(dispositivos añadidos a Gladys). El botón **Actualizar** vuelve a leer n8n.

## Escenas

### Disparadores

- **Una ejecución de workflow falla**: una ejecución termina en error (o se
  bloquea). Filtro: los workflows (vacío: todos). Información transmitida:
  nombre del workflow, mensaje de error, nodo con error, número de la
  ejecución, enlace a la ejecución en n8n.
- **n8n no está accesible**: dos lecturas seguidas han fallado. Información
  transmitida: el motivo.
- **n8n responde de nuevo**: tras no estar accesible, con la duración de la
  caída en minutos.

La primera lectura solo anota lo que ya ha ocurrido: no se anuncia nada del
pasado. Un fallo ocurrido durante un reinicio de Gladys o de la integración se
anuncia una vez, en la lectura siguiente.

### Acciones

- **Iniciar un workflow de n8n**: la API de n8n no puede iniciar un workflow,
  su nodo **Webhook** sí. En n8n, añada un nodo disparador Webhook, ponga su
  **HTTP Method** en `POST`, dele un **Path** (`gladys-hola`) y active el
  workflow. En la escena, indique esa ruta (o la **URL de producción** completa
  del nodo) y un cuerpo: JSON como `{"sala": "salón"}`, o un texto enviado
  como `{"text": "…"}`; se pueden insertar valores de la escena. Resultados:
  respuesta correcta, estado HTTP (0 sin respuesta en 25 segundos), mensaje de
  respuesta (el campo `message` o `text` de la respuesta), respuesta completa.
  Para obtener una respuesta, ponga **Respond** en «When Last Node Finishes» o
  use un nodo «Respond to Webhook»; un workflow de más de 25 segundos debería
  responder de inmediato.
- **Estado de un workflow**: activo o no, última ejecución fallida o no,
  estado, fallos en 24 h, último inicio, duración, último error y una frase
  preparada, para las acciones siguientes (un mensaje, una condición).
- **Activar un workflow** / **Desactivar un workflow**: por ejemplo un workflow
  que solo debe ejecutarse durante las vacaciones. Estas acciones funcionan
  sea cual sea la opción del interruptor.

### Ideas de escenas

- **Una ejecución de workflow falla** → enviar un mensaje: «n8n: {workflow} ha
  fallado en {nodo}: {error}» con el enlace a la ejecución.
- Un botón del panel o «Me voy» → **Iniciar un workflow de n8n**
  `gladys-salida` con `{"usuario": "…"}`, y después enviar el **Mensaje de
  respuesta** del workflow.
- **n8n no está accesible** → enviar un mensaje y encender una luz del
  despacho.
- Cada mañana → **Estado de un workflow** «Copia de seguridad nocturna» →
  continuar solo si «Última ejecución fallida» es verdadero → enviar la
  **Frase**.

## Solución de problemas

- **Clave de API rechazada**: la clave se borró, caducó o se copió
  incompleta. Cree una nueva.
- **Rechazado por n8n: a la clave de API le falta un permiso**: dé a la clave
  los permisos del paso 1, o use una clave del propietario del workflow.
- **No hay ninguna API de n8n en esta dirección**: compruebe la dirección
  (puerto 5678 por defecto) y que la API pública está activada. Detrás de un
  proxy inverso con subruta, ponga la subruta en la dirección.
- **La dirección redirige**: introduzca la dirección `https://`.
- **Certificado rechazado**: no se acepta un certificado autofirmado; use la
  dirección `http://` en la red local.
- **El webhook responde 404 «not registered»**: el workflow no está activo, la
  ruta es incorrecta, o el nodo Webhook no acepta `POST`. Una URL de prueba
  (`/webhook-test/`) solo funciona mientras el editor escucha.
- **No se ve ningún fallo**: n8n debe guardar las ejecuciones fallidas
  (`EXECUTIONS_DATA_SAVE_ON_ERROR`, activado por defecto). Las ejecuciones
  correctas no guardadas (`EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`) dejan
  «Última ejecución» en el último fallo.
- Registros: en Gladys, la página de la integración muestra los registros de
  su contenedor; `LOG_LEVEL=debug` detalla cada lectura.

## Límites

- Una instancia de n8n por configuración; la clave ve los workflows de su
  propietario.
- Los workflows no se crean ni se editan desde Gladys.
- La primera lectura cuenta como mucho 500 ejecuciones fallidas de las últimas
  24 horas, y se anuncian como mucho 10 fallos por lectura.
- El cuerpo del webhook es solo JSON; los webhooks protegidos por cabecera o
  por autenticación básica no están soportados (use una ruta difícil de
  adivinar).
- n8n Cloud no está probado.
