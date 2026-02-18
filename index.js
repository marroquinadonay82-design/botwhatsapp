const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const axios = require('axios');

const TIMEZONE = 'America/El_Salvador';
const ADMIN_CREDENTIALS = {
    username: "jarabe",
    password: "jarabe123"
};

const FIREBASE_CONFIG = {
    databaseURL: "https://seguridadterritorial-64f0f-default-rtdb.firebaseio.com/"
};

const userStates = new Map();
const scheduledMessages = [];
let availableGroups = [];

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "bot-seguridad",
        dataPath: path.join(__dirname, 'whatsapp-session')
    }),
    puppeteer: {
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--disable-font-subpixel-positioning'
        ]
    },
    webVersionCache: {
        type: "remote",
        remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html"
    }
});

function crearCarpetas() {
    const carpetas = [
        path.join(__dirname, 'whatsapp-session'),
        path.join(__dirname, 'temp'),
        path.join(__dirname, 'media'),
        path.join(__dirname, 'imagenes-programadas'),
        path.join(__dirname, 'videos-programados'),
        path.join(__dirname, 'pdf-programados')
    ];
    
    carpetas.forEach(carpeta => {
        if (!fs.existsSync(carpeta)) {
            fs.mkdirSync(carpeta, { recursive: true });
        }
    });
}

function obtenerSaludo() {
    const horaActual = moment().tz(TIMEZONE).hour();
    
    if (horaActual >= 6 && horaActual < 12) {
        return "buenos días";
    } else if (horaActual >= 12 && horaActual < 18) {
        return "buenas tardes";
    } else {
        return "buenas noches";
    }
}

function parsearHora(horaString) {
    const regex24h = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
    const regex12h = /^([0-1]?[0-9]):([0-5][0-9])\s*(am|pm)$/i;
    
    horaString = horaString.trim().toLowerCase();
    
    if (regex24h.test(horaString)) {
        const [horas, minutos] = horaString.split(':');
        return `${horas.padStart(2, '0')}:${minutos}`;
    }
    
    if (regex12h.test(horaString)) {
        const match = horaString.match(/^(\d+):(\d+)\s*(am|pm)$/);
        let horas = parseInt(match[1]);
        const minutos = match[2];
        const periodo = match[3];
        
        if (periodo === 'pm' && horas < 12) horas += 12;
        if (periodo === 'am' && horas === 12) horas = 0;
        
        return `${horas.toString().padStart(2, '0')}:${minutos}`;
    }
    
    return null;
}

async function guardarArchivo(media, userId, tipo) {
    let carpeta = '';
    let extension = '';
    
    if (tipo === 'imagen') {
        carpeta = path.join(__dirname, 'media', 'imagenes');
        extension = media.mimetype.includes('jpeg') ? '.jpg' : 
                   media.mimetype.includes('png') ? '.png' : 
                   media.mimetype.includes('gif') ? '.gif' : '.jpg';
    } else if (tipo === 'video') {
        carpeta = path.join(__dirname, 'media', 'videos');
        extension = media.mimetype.includes('mp4') ? '.mp4' : 
                   media.mimetype.includes('avi') ? '.avi' : 
                   media.mimetype.includes('mov') ? '.mov' : '.mp4';
    } else if (tipo === 'pdf' || tipo === 'documento') {
        carpeta = path.join(__dirname, 'media', 'documentos');
        extension = media.mimetype.includes('pdf') ? '.pdf' : 
                   media.mimetype.includes('word') ? '.docx' : '.pdf';
    } else {
        carpeta = path.join(__dirname, 'media', 'otros');
        extension = '.dat';
    }
    
    if (!fs.existsSync(carpeta)) {
        fs.mkdirSync(carpeta, { recursive: true });
    }
    
    const nombreArchivo = `${tipo}_${userId}_${Date.now()}${extension}`;
    const rutaCompleta = path.join(carpeta, nombreArchivo);
    
    const buffer = Buffer.from(media.data, 'base64');
    fs.writeFileSync(rutaCompleta, buffer);
    
    return {
        ruta: rutaCompleta,
        tipo: tipo,
        mimetype: media.mimetype,
        nombre: nombreArchivo
    };
}

async function obtenerGrupos() {
    try {
        const chats = await client.getChats();
        const grupos = chats.filter(chat => chat.isGroup);
        return grupos;
    } catch (error) {
        return [];
    }
}

function generarVistaPrevia(datos) {
    let preview = "📋 *VISTA PREVIA DEL MENSAJE*\n\n";
    
    if (datos.archivoInfo) {
        preview += `📎 *Archivo:* ${datos.archivoInfo.tipo.toUpperCase()} adjunto ✅\n`;
        preview += `📄 *Tipo:* ${datos.archivoInfo.mimetype}\n`;
    } else if (datos.imagenPath) {
        preview += "🖼️ *Imagen:* Adjuntada ✅\n";
    } else {
        preview += "📎 *Archivo:* Sin archivo adjunto\n";
    }
    
    if (datos.mensaje && datos.mensaje !== "") {
        preview += `💬 *Mensaje:* ${datos.mensaje}\n`;
    }
    
    preview += `⏰ *Horas programadas:* ${datos.horas.join(', ')}\n`;
    preview += `📅 *Frecuencia:* ${datos.frecuencia === 'una_vez' ? 'Una sola vez' : 
                datos.frecuencia === 'diario' ? 'Diariamente' : 
                datos.frecuencia === 'semanal' ? 'Semanalmente' : 'Personalizado'}\n`;
    
    if (datos.fechaInicio) {
        preview += `📅 *Fecha inicio:* ${moment(datos.fechaInicio).tz(TIMEZONE).format('DD/MM/YYYY')}\n`;
    }
    
    if (datos.fechaFin) {
        preview += `📅 *Fecha fin:* ${moment(datos.fechaFin).tz(TIMEZONE).format('DD/MM/YYYY')}\n`;
    }
    
    if (datos.enviarATodos) {
        preview += `👥 *Enviar a:* Todos los grupos\n`;
    } else if (datos.gruposSeleccionados && datos.gruposSeleccionados.length > 0) {
        preview += `👥 *Enviar a:* ${datos.gruposSeleccionados.length} grupo(s) seleccionado(s)\n`;
    }
    
    preview += `\n📅 *Fecha de creación:* ${moment().tz(TIMEZONE).format('DD/MM/YYYY HH:mm')}\n`;
    
    return preview;
}

const GRUPOS_DISPONIBLES = [
    "Cazadores del sabor",
    "Heroes del sabor", 
    "Caramelos del sabor",
    "Linea 6"
];

const MESES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

async function obtenerChecklistSeguridad(message, userId) {
    const menuOpciones = `✅ *CHECKLIST DE SEGURIDAD*\n\n¿Qué deseas verificar?\n\n1️⃣ - Grupos\n2️⃣ - Técnicos\n\n*Envía el número de la opción (1-2)*\nO envía *cancelar* para regresar al menú principal.`;
    
    await message.reply(menuOpciones);
    userStates.set(userId, { 
        estado: 'checklist_menu_principal',
        datos: {}
    });
}

async function obtenerGruposDisponibles(message, userId) {
    try {
        console.log('🔍 Consultando grupos desde Dashboard de seguridad...');
        
        const response = await axios.get(`${FIREBASE_CONFIG.databaseURL}/registros.json`, {
            timeout: 15000
        });
        
        const usuarios = response.data || {};
        const gruposUnicos = new Set();
        
        Object.values(usuarios).forEach(usuario => {
            if (usuario.grupo) {
                gruposUnicos.add(usuario.grupo);
            }
        });
        
        const grupos = gruposUnicos.size > 0 ? Array.from(gruposUnicos) : GRUPOS_DISPONIBLES;
        
        let menuGrupos = `👥 *GRUPOS DISPONIBLES*\n\n`;
        grupos.forEach((grupo, index) => {
            menuGrupos += `${index + 1}️⃣ - ${grupo}\n`;
        });
        
        menuGrupos += `\n*Selecciona el número del grupo que deseas consultar*\nO envía *cancelar* para regresar.`;
        
        await message.reply(menuGrupos);
        
        userStates.set(userId, { 
            estado: 'checklist_esperando_grupo',
            datos: { grupos: grupos }
        });
        
    } catch (error) {
        console.error("Error al obtener grupos:", error);
        
        let menuGrupos = `👥 *GRUPOS DISPONIBLES*\n\n`;
        GRUPOS_DISPONIBLES.forEach((grupo, index) => {
            menuGrupos += `${index + 1}️⃣ - ${grupo}\n`;
        });
        
        menuGrupos += `\n*Selecciona el número del grupo que deseas consultar*\nO envía *cancelar* para regresar.`;
        
        await message.reply(menuGrupos);
        
        userStates.set(userId, { 
            estado: 'checklist_esperando_grupo',
            datos: { grupos: GRUPOS_DISPONIBLES }
        });
    }
}

async function obtenerAnosDisponibles(message, userId, tipo, identificador) {
    try {
        let anosSet = new Set();
        const añoActual = moment().tz(TIMEZONE).year();
        
        anosSet.add(añoActual);
        anosSet.add(añoActual - 1);
        
        const reportesResponse = await axios.get(`${FIREBASE_CONFIG.databaseURL}/reportes_seguridad.json`, {
            timeout: 15000
        });
        const reportes = reportesResponse.data || {};
        
        Object.values(reportes).forEach(report => {
            if (report.fecha) {
                const añoReporte = moment(report.fecha).year();
                if (añoReporte >= 2020) {
                    anosSet.add(añoReporte);
                }
            }
        });
        
        const anos = Array.from(anosSet).sort((a, b) => b - a);
        
        let menuAnos = `📅 *SELECCIONA EL AÑO*\n\n`;
        if (tipo === 'grupo') {
            menuAnos += `Grupo: *${identificador}*\n\n`;
        } else {
            menuAnos += `Técnico: *${identificador}*\n\n`;
        }
        
        anos.forEach((ano, index) => {
            menuAnos += `${index + 1}️⃣ - ${ano}\n`;
        });
        
        menuAnos += `\n*Envía el número del año*\nO envía *cancelar* para regresar.`;
        
        await message.reply(menuAnos);
        
        userStates.set(userId, { 
            estado: tipo === 'grupo' ? 'checklist_esperando_ano_grupo' : 'checklist_esperando_ano_tecnico',
            datos: { 
                [tipo]: identificador,
                anos: anos,
                tecnicoInfo: userId
            }
        });
        
    } catch (error) {
        console.error("Error al obtener años:", error);
        await message.reply("❌ Error al consultar años disponibles. Usando año actual.");
        
        if (tipo === 'grupo') {
            await obtenerMesesGrupo(message, userId, identificador, moment().tz(TIMEZONE).year());
        } else {
            await obtenerMesesTecnico(message, userId, identificador, moment().tz(TIMEZONE).year());
        }
    }
}

async function obtenerMesesGrupo(message, userId, grupoSeleccionado, añoSeleccionado) {
    let menuMeses = `📅 *SELECCIONA EL MES*\n\nGrupo: *${grupoSeleccionado}*\nAño: *${añoSeleccionado}*\n\n`;
    
    for (let i = 0; i < MESES.length; i++) {
        menuMeses += `${i + 1}️⃣ - ${MESES[i]}\n`;
    }
    
    menuMeses += `\n*Envía el número del mes (1-12)*\nO envía *cancelar* para regresar.`;
    
    await message.reply(menuMeses);
    
    userStates.set(userId, { 
        estado: 'checklist_esperando_mes_grupo',
        datos: { grupo: grupoSeleccionado, año: añoSeleccionado }
    });
}

async function obtenerResultadosGrupo(message, userId, grupo, añoSeleccionado, mesSeleccionado) {
    try {
        await message.reply(`🔍 Buscando resultados para *${grupo}* de *${MESES[mesSeleccionado - 1]} ${añoSeleccionado}*...`);
        
        const fechaInicio = moment().tz(TIMEZONE).year(añoSeleccionado).month(mesSeleccionado - 1).startOf('month');
        const fechaFin = moment().tz(TIMEZONE).year(añoSeleccionado).month(mesSeleccionado - 1).endOf('month');
        
        console.log(`Consultando reportes desde ${fechaInicio.format('YYYY-MM-DD')} hasta ${fechaFin.format('YYYY-MM-DD')}`);
        
        const usuariosResponse = await axios.get(`${FIREBASE_CONFIG.databaseURL}/registros.json`, {
            timeout: 15000
        });
        const usuarios = usuariosResponse.data || {};
        
        const reportesResponse = await axios.get(`${FIREBASE_CONFIG.databaseURL}/reportes_seguridad.json`, {
            timeout: 15000
        });
        const reportes = reportesResponse.data || {};
        
        const usuariosGrupo = [];
        Object.entries(usuarios).forEach(([userId, usuario]) => {
            if (usuario.grupo === grupo) {
                const nombreCompleto = `${usuario.nombres || ''} ${usuario.apellidos || ''}`.trim();
                usuariosGrupo.push({
                    id: userId,
                    nombre: nombreCompleto || 'Sin nombre',
                    codigo: usuario.codigo || 'Sin código',
                    grupo: usuario.grupo
                });
            }
        });
        
        const reportesFiltrados = [];
        Object.values(reportes).forEach(report => {
            if (report.fecha && report.grupo_usuario === grupo) {
                const fechaReporte = moment(report.fecha);
                if (fechaReporte.isBetween(fechaInicio, fechaFin, null, '[]')) {
                    reportesFiltrados.push(report);
                }
            }
        });
        
        const estadisticasTecnicos = {};
        
        usuariosGrupo.forEach(usuario => {
            estadisticasTecnicos[usuario.nombre] = {
                nombre: usuario.nombre,
                codigo: usuario.codigo,
                diario: 0,
                semanal: 0,
                mensual: 0,
                total: 0
            };
        });
        
        reportesFiltrados.forEach(report => {
            const tecnico = report.usuario;
            if (estadisticasTecnicos[tecnico]) {
                if (report.seguimiento === 'diario') {
                    estadisticasTecnicos[tecnico].diario++;
                } else if (report.seguimiento === 'semanal') {
                    estadisticasTecnicos[tecnico].semanal++;
                } else if (report.seguimiento === 'mensual') {
                    estadisticasTecnicos[tecnico].mensual++;
                }
                estadisticasTecnicos[tecnico].total++;
            }
        });
        
        const totalTecnicos = usuariosGrupo.length;
        const totalDiario = Object.values(estadisticasTecnicos).reduce((sum, t) => sum + t.diario, 0);
        const totalSemanal = Object.values(estadisticasTecnicos).reduce((sum, t) => sum + t.semanal, 0);
        const totalMensual = Object.values(estadisticasTecnicos).reduce((sum, t) => sum + t.mensual, 0);
        
        const maxDiario = 20 * totalTecnicos;
        const maxSemanal = 4 * totalTecnicos;
        const maxMensual = 1 * totalTecnicos;
        
        const porcentajeDiario = maxDiario > 0 ? Math.min(Math.round((totalDiario / maxDiario) * 100), 100) : 0;
        const porcentajeSemanal = maxSemanal > 0 ? Math.min(Math.round((totalSemanal / maxSemanal) * 100), 100) : 0;
        const porcentajeMensual = maxMensual > 0 ? Math.min(Math.round((totalMensual / maxMensual) * 100), 100) : 0;
        
        let resultado = `📊 *RESULTADOS CHECKLIST DE SEGURIDAD*\n\n`;
        resultado += `👥 *Grupo:* ${grupo}\n`;
        resultado += `📅 *Período:* ${MESES[mesSeleccionado - 1]} ${añoSeleccionado}\n`;
        resultado += `👤 *Total técnicos:* ${totalTecnicos}\n`;
        resultado += `📋 *Total reportes:* ${reportesFiltrados.length}\n\n`;
        
        resultado += `📈 *ESTADÍSTICAS GENERALES:*\n`;
        resultado += `• Diarios: ${totalDiario}/${maxDiario} (${porcentajeDiario}%)\n`;
        resultado += `• Semanales: ${totalSemanal}/${maxSemanal} (${porcentajeSemanal}%)\n`;
        resultado += `• Mensuales: ${totalMensual}/${maxMensual} (${porcentajeMensual}%)\n\n`;
        
        resultado += `📋 *DETALLE POR TÉCNICO:*\n\n`;
        
        const tecnicosOrdenados = Object.values(estadisticasTecnicos).sort((a, b) => b.total - a.total);
        
        tecnicosOrdenados.forEach(tecnico => {
            if (tecnico.nombre && tecnico.nombre !== 'Sin nombre') {
                const porcentajePromedio = 3 > 0 ? Math.round((tecnico.diario/20 + tecnico.semanal/4 + tecnico.mensual/1) / 3 * 100) : 0;
                
                resultado += `👤 *${tecnico.nombre}* (${tecnico.codigo})\n`;
                resultado += `   📅 Diario: ${tecnico.diario}/20 (${Math.min(Math.round(tecnico.diario/20*100), 100)}%)\n`;
                resultado += `   📅 Semanal: ${tecnico.semanal}/4 (${Math.min(Math.round(tecnico.semanal/4*100), 100)}%)\n`;
                resultado += `   📅 Mensual: ${tecnico.mensual}/1 (${Math.min(Math.round(tecnico.mensual/1*100), 100)}%)\n`;
                resultado += `   📊 Promedio: ${porcentajePromedio}%\n\n`;
            }
        });
        
        resultado += `⏰ *Consulta:* ${moment().tz(TIMEZONE).format('DD/MM/YYYY HH:mm')}\n`;
        resultado += `🔗 *Fuente:* Dashboard de seguridad territorial`;
        
        await message.reply(resultado);
        
        await message.reply(`¿Deseas consultar otro período para el mismo grupo?\n\n1️⃣ - Sí\n2️⃣ - No, volver al menú principal\n\nEnvía el número de la opción.`);
        
        userStates.set(userId, { 
            estado: 'checklist_consultar_otro_periodo_grupo',
            datos: { grupo: grupo }
        });
        
    } catch (error) {
        console.error("Error al obtener resultados del grupo:", error);
        
        await message.reply(`❌ *Error al consultar resultados*\n\nNo se pudo obtener la información del grupo ${grupo}.\n\nDetalles: ${error.message}\n\nIntenta nuevamente más tarde.`);
        
        userStates.delete(userId);
        await enviarMenu(message);
    }
}

async function obtenerInfoTecnico(message, userId) {
    await message.reply(
        `👤 *CONSULTAR TÉCNICO*\n\n` +
        `Por favor, ingresa el *código del técnico* que deseas consultar.\n\n` +
        `*Ejemplos:*\n` +
        `• 12345\n` +
        `• 76001111\n` +
        `• 1111\n\n` +
        `O envía *cancelar* para regresar.`
    );
    
    userStates.set(userId, { 
        estado: 'checklist_esperando_codigo_tecnico',
        datos: {}
    });
}

async function obtenerMesesTecnico(message, userId, codigoTecnico, añoSeleccionado) {
    try {
        const usuariosResponse = await axios.get(`${FIREBASE_CONFIG.databaseURL}/registros.json`, {
            timeout: 15000
        });
        const usuarios = usuariosResponse.data || {};
        
        let tecnicoEncontrado = null;
        let nombreTecnico = null;
        
        for (const [userId, usuario] of Object.entries(usuarios)) {
            if (usuario.codigo && usuario.codigo.toString().includes(codigoTecnico)) {
                tecnicoEncontrado = usuario;
                nombreTecnico = `${usuario.nombres || ''} ${usuario.apellidos || ''}`.trim();
                break;
            }
        }
        
        if (!tecnicoEncontrado) {
            await message.reply(`❌ *Técnico no encontrado*\n\nNo se encontró ningún técnico con el código *${codigoTecnico}*.\n\nVerifica el código e intenta nuevamente.`);
            
            await obtenerInfoTecnico(message, userId);
            return;
        }
        
        let menuMeses = `📅 *SELECCIONA EL MES*\n\nTécnico: *${nombreTecnico || 'Desconocido'}* (${codigoTecnico})\nAño: *${añoSeleccionado}*\n\n`;
        
        for (let i = 0; i < MESES.length; i++) {
            menuMeses += `${i + 1}️⃣ - ${MESES[i]}\n`;
        }
        
        menuMeses += `\n*Envía el número del mes (1-12)*\nO envía *cancelar* para regresar.`;
        
        await message.reply(menuMeses);
        
        userStates.set(userId, { 
            estado: 'checklist_esperando_mes_tecnico',
            datos: { 
                codigo: codigoTecnico,
                tecnico: tecnicoEncontrado,
                nombre: nombreTecnico,
                año: añoSeleccionado
            }
        });
        
    } catch (error) {
        console.error("Error al buscar técnico:", error);
        
        await message.reply(`❌ *Error al buscar técnico*\n\nNo se pudo conectar con la base de datos.\n\nIntenta nuevamente más tarde.`);
        
        userStates.delete(userId);
        await enviarMenu(message);
    }
}

async function obtenerResultadosTecnico(message, userId, tecnicoInfo, añoSeleccionado, mesSeleccionado) {
    try {
        const codigo = tecnicoInfo.codigo;
        const nombreCompleto = tecnicoInfo.nombre || `${tecnicoInfo.tecnico.nombres || ''} ${tecnicoInfo.tecnico.apellidos || ''}`.trim();
        
        await message.reply(`🔍 Buscando resultados para *${nombreCompleto}* de *${MESES[mesSeleccionado - 1]} ${añoSeleccionado}*...`);
        
        const fechaInicio = moment().tz(TIMEZONE).year(añoSeleccionado).month(mesSeleccionado - 1).startOf('month');
        const fechaFin = moment().tz(TIMEZONE).year(añoSeleccionado).month(mesSeleccionado - 1).endOf('month');
        
        console.log(`Consultando reportes desde ${fechaInicio.format('YYYY-MM-DD')} hasta ${fechaFin.format('YYYY-MM-DD')}`);
        
        const reportesResponse = await axios.get(`${FIREBASE_CONFIG.databaseURL}/reportes_seguridad.json`, {
            timeout: 15000
        });
        const reportes = reportesResponse.data || {};
        
        let diario = 0;
        let semanal = 0;
        let mensual = 0;
        
        Object.values(reportes).forEach(report => {
            if (report.usuario === nombreCompleto && report.fecha) {
                const fechaReporte = moment(report.fecha);
                if (fechaReporte.isBetween(fechaInicio, fechaFin, null, '[]')) {
                    if (report.seguimiento === 'diario') diario++;
                    else if (report.seguimiento === 'semanal') semanal++;
                    else if (report.seguimiento === 'mensual') mensual++;
                }
            }
        });
        
        const limiteDiario = 20;
        const limiteSemanal = 4;
        const limiteMensual = 1;
        
        const porcentajeDiario = Math.min(Math.round((diario / limiteDiario) * 100), 100);
        const porcentajeSemanal = Math.min(Math.round((semanal / limiteSemanal) * 100), 100);
        const porcentajeMensual = Math.min(Math.round((mensual / limiteMensual) * 100), 100);
        const porcentajeTotal = Math.round((diario/limiteDiario + semanal/limiteSemanal + mensual/limiteMensual) / 3 * 100);
        
        let resultado = `📊 *RESULTADOS CHECKLIST DE SEGURIDAD*\n\n`;
        resultado += `👤 *Técnico:* ${nombreCompleto}\n`;
        resultado += `🔢 *Código:* ${codigo}\n`;
        resultado += `📅 *Período:* ${MESES[mesSeleccionado - 1]} ${añoSeleccionado}\n\n`;
        
        resultado += `📈 *ESTADÍSTICAS:*\n\n`;
        
        resultado += `📅 *Formularios Diarios:*\n`;
        resultado += `   • Completados: ${diario}\n`;
        resultado += `   • Límite: ${limiteDiario}\n`;
        resultado += `   • Porcentaje: ${porcentajeDiario}%\n`;
        
        resultado += `   `;
        for (let i = 0; i < 20; i++) {
            if (i < Math.round(diario / 2)) resultado += `█`;
            else resultado += `░`;
        }
        resultado += `\n\n`;
        
        resultado += `📆 *Formularios Semanales:*\n`;
        resultado += `   • Completados: ${semanal}\n`;
        resultado += `   • Límite: ${limiteSemanal}\n`;
        resultado += `   • Porcentaje: ${porcentajeSemanal}%\n`;
        
        resultado += `   `;
        for (let i = 0; i < 20; i++) {
            if (i < Math.round(semanal * 5)) resultado += `█`;
            else resultado += `░`;
        }
        resultado += `\n\n`;
        
        resultado += `📊 *Formularios Mensuales:*\n`;
        resultado += `   • Completados: ${mensual}\n`;
        resultado += `   • Límite: ${limiteMensual}\n`;
        resultado += `   • Porcentaje: ${porcentajeMensual}%\n`;
        
        resultado += `   `;
        for (let i = 0; i < 20; i++) {
            if (i < (mensual * 20)) resultado += `█`;
            else resultado += `░`;
        }
        resultado += `\n\n`;
        
        resultado += `🎯 *CUMPLIMIENTO TOTAL: ${porcentajeTotal}%*\n\n`;
        
        resultado += `📋 *EVALUACIÓN:*\n`;
        if (porcentajeTotal >= 90) {
            resultado += `✅ *EXCELENTE* - Cumplimiento sobresaliente\n`;
        } else if (porcentajeTotal >= 75) {
            resultado += `👍 *BUENO* - Buen cumplimiento\n`;
        } else if (porcentajeTotal >= 50) {
            resultado += `⚠️ *REGULAR* - Necesita mejorar\n`;
        } else {
            resultado += `❌ *BAJO* - Incumplimiento crítico\n`;
        }
        
        resultado += `\n⏰ *Consulta:* ${moment().tz(TIMEZONE).format('DD/MM/YYYY HH:mm')}\n`;
        resultado += `🔗 *Fuente:* Dashboard de seguridad territorial`;
        
        await message.reply(resultado);
        
        await message.reply(`¿Deseas consultar otro período para el mismo técnico?\n\n1️⃣ - Sí\n2️⃣ - No, volver al menú principal\n\nEnvía el número de la opción.`);
        
        userStates.set(userId, { 
            estado: 'checklist_consultar_otro_periodo_tecnico',
            datos: { 
                codigo: codigo,
                tecnico: tecnicoInfo.tecnico,
                nombre: nombreCompleto
            }
        });
        
    } catch (error) {
        console.error("Error al obtener resultados del técnico:", error);
        
        await message.reply(`❌ *Error al consultar resultados*\n\nNo se pudo obtener la información del técnico.\n\nDetalles: ${error.message}\n\nIntenta nuevamente más tarde.`);
        
        userStates.delete(userId);
        await enviarMenu(message);
    }
}

async function obtenerSemaforoTerritorio() {
    try {
        console.log('🔍 Consultando semáforo de territorios desde Semáforo Territorial...');
        
        const FIREBASE_CONFIG_FIRESTORE = {
            apiKey: "AIzaSyA_-UWmel0SkQfgcTOEf2tgcOjYFVkYR2M",
            authDomain: "seguridad-ae995.firebaseapp.com",
            projectId: "seguridad-ae995",
            storageBucket: "seguridad-ae995.firebasestorage.app",
            messagingSenderId: "204933074839",
            appId: "1:204933074839:web:cfe171257a37966413fed2"
        };

        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG_FIRESTORE.projectId}/databases/(default)/documents/territories`;
        
        const response = await axios.get(firestoreUrl, {
            timeout: 15000,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const documents = response.data.documents || [];
        
        const territoriosValidos = {};
        for (let i = 1; i <= 9; i++) {
            territoriosValidos[`territory_${i}`] = i;
        }

        const territoriosEnRojo = [];
        const detallesTerritorios = [];

        for (const doc of documents) {
            const pathParts = doc.name.split('/');
            const territoryId = pathParts[pathParts.length - 1];
            
            if (!territoriosValidos[territoryId]) {
                console.log(`⚠️ Ignorando documento no válido: ${territoryId}`);
                continue;
            }

            const territorioNumero = territoriosValidos[territoryId];
            const fields = doc.fields || {};
            
            let status = 'unknown';
            let statusText = '';
            
            if (fields.status) {
                if (fields.status.stringValue) {
                    statusText = fields.status.stringValue.toLowerCase();
                    status = statusText === 'danger' ? 'danger' : 'safe';
                } else if (fields.status.integerValue !== undefined) {
                    const statusNum = parseInt(fields.status.integerValue);
                    status = statusNum === 1 ? 'danger' : 'safe';
                    statusText = status === 'danger' ? 'danger' : 'safe';
                } else if (fields.status.booleanValue !== undefined) {
                    status = fields.status.booleanValue ? 'danger' : 'safe';
                    statusText = status;
                }
            }
            
            if (status === 'danger') {
                territoriosEnRojo.push(`Territorio ${territorioNumero}`);
                
                let owner = 'No asignado';
                if (fields.owner && fields.owner.stringValue) {
                    owner = fields.owner.stringValue;
                }

                const unsafeConditions = [];
                
                if (fields.unsafeConditions && fields.unsafeConditions.arrayValue) {
                    const conditionsArray = fields.unsafeConditions.arrayValue.values || [];
                    
                    for (const conditionItem of conditionsArray) {
                        if (conditionItem.mapValue && conditionItem.mapValue.fields) {
                            const conditionFields = conditionItem.mapValue.fields;
                            
                            let conditionStatus = 'active';
                            if (conditionFields.status && conditionFields.status.stringValue) {
                                conditionStatus = conditionFields.status.stringValue;
                            }
                            
                            if (conditionStatus !== 'cerrada') {
                                const condition = {
                                    descripcion: conditionFields.description?.stringValue || 'Sin descripción',
                                    fecha: conditionFields.timestamp?.timestampValue ? 
                                        new Date(conditionFields.timestamp.timestampValue).toLocaleDateString() : 'Sin fecha',
                                    medidaControl: conditionFields.controlMeasure?.stringValue || 'Sin medida de control',
                                    status: conditionStatus
                                };
                                unsafeConditions.push(condition);
                            }
                        }
                    }
                }
                
                try {
                    const subcollectionUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG_FIRESTORE.projectId}/databases/(default)/documents/territories/${territoryId}/unsafeConditions`;
                    const subResponse = await axios.get(subcollectionUrl, { timeout: 5000 });
                    
                    if (subResponse.data.documents) {
                        for (const conditionDoc of subResponse.data.documents) {
                            const conditionFields = conditionDoc.fields || {};
                            
                            let conditionStatus = conditionFields.status?.stringValue || 'active';
                            
                            if (conditionStatus !== 'cerrada') {
                                const condition = {
                                    descripcion: conditionFields.description?.stringValue || 'Sin descripción',
                                    fecha: conditionFields.timestamp?.timestampValue ? 
                                        new Date(conditionFields.timestamp.timestampValue).toLocaleDateString() : 'Sin fecha',
                                    medidaControl: conditionFields.controlMeasure?.stringValue || 'Sin medida de control',
                                    status: conditionStatus
                                };
                                unsafeConditions.push(condition);
                            }
                        }
                    }
                } catch (subError) {
                    
                }

                detallesTerritorios.push({
                    numero: territorioNumero,
                    id: territoryId,
                    owner: owner,
                    unsafeConditions: unsafeConditions
                });
            }
        }
        
        let resultado = "🚦 *INFORME SEMÁFORO DE TERRITORIOS*\n\n";
        resultado += "⏰ *Fecha y hora:* " + moment().tz(TIMEZONE).format('DD/MM/YYYY HH:mm') + "\n\n";

        if (territoriosEnRojo.length === 0) {
            resultado += "✅ *ESTADO ACTUAL:* Todos los 9 territorios están en verde ✅\n\n";
            resultado += "No hay territorios en rojo. Todas las áreas operan de manera segura.\n";
        } else {
            resultado += `🔴 *ESTADO ACTUAL:* ${territoriosEnRojo.length} de 9 territorios en rojo.\n\n`;
            resultado += `*Territorios en rojo:* ${territoriosEnRojo.join(', ')}\n\n`;
            
            resultado += `📋 *DETALLES DE TERRITORIOS EN ROJO:*\n\n`;
            
            detallesTerritorios.forEach((territorio) => {
                resultado += `📍 *TERRITORIO ${territorio.numero}*\n`;
                resultado += `• *Dueño:* ${territorio.owner}\n`;
                
                if (territorio.unsafeConditions && territorio.unsafeConditions.length > 0) {
                    resultado += `• *Condiciones inseguras activas:* ${territorio.unsafeConditions.length}\n`;
                    
                    territorio.unsafeConditions.forEach((condicion, idx) => {
                        resultado += `\n  *Condición ${idx + 1}:*\n`;
                        resultado += `  📝 *Descripción:* ${condicion.descripcion}\n`;
                        resultado += `  📅 *Fecha:* ${condicion.fecha}\n`;
                        resultado += `  ✅ *Medida de control:* ${condicion.medidaControl}\n`;
                        resultado += `  📊 *Estado:* ${condicion.status === 'active' ? 'Activa' : condicion.status}\n`;
                    });
                } else {
                    resultado += `• *Condiciones inseguras:* No hay condiciones activas registradas\n`;
                }
                
                resultado += `\n`;
            });
        }

        resultado += "\n📊 *INFORMACIÓN GENERAL:*\n";
        resultado += "• Total territorios monitoreados: 9\n";
        resultado += "• Verde: Condiciones seguras\n";
        resultado += "• Rojo: Condiciones inseguras detectadas\n\n";
        
        resultado += "🔗 *Fuente:* Semáforo de territorios\n";
        resultado += "⚠️ *Para más detalles, visita:* https://territorios-jarabe.web.app/\n";

        console.log(`✅ Información obtenida de Firestore. Territorios en rojo: ${territoriosEnRojo.length}`);
        return resultado;

    } catch (error) {
        console.error("Error en obtenerSemaforoTerritorio (Firestore):", error.message);
        
        let mensajeError = "🚦 *INFORME SEMÁFORO DE TERRITORIOS*\n\n";
        mensajeError += "❌ *Error al obtener información*\n\n";
        mensajeError += "No se pudo conectar con la base de datos de Firestore.\n\n";
        mensajeError += "🔗 *Enlace alternativo:* https://territorios-jarabe.web.app/\n";
        mensajeError += "⏰ *Hora:* " + moment().tz(TIMEZONE).format('DD/MM/YYYY HH:mm') + "\n\n";
        mensajeError += "💡 *Solución:*\n";
        mensajeError += "1. Verifica tu conexión a internet\n";
        mensajeError += "2. Verifica si la base de datos está disponible\n";
        mensajeError += "3. Contacta al administrador 👻\n\n";
        mensajeError += "📞 *Reporta este error al supervisor de turno*";
        
        return mensajeError;
    }
}

const FIREBASE_CONFIG_ILC = {
    apiKey: "AIzaSyDYSicDGQc48QLUtWHroRB30UNbATFu4c8",
    databaseURL: "https://conocestusbrechas-d911a-default-rtdb.firebaseio.com"
};

const FIREBASE_CONFIG_OUTS = {
    apiKey: "AIzaSyBX0_IzQWnUrdhHH-H0jMNbAp0thOVhfpU",
    databaseURL: "https://skapdeouts-default-rtdb.firebaseio.com"
};

function esNoAplica(respuesta) {
    if (!respuesta) return false;
    
    const feedback = respuesta.feedback || '';
    const comentario = respuesta.comentario || '';
    const estado = respuesta.estado || '';
    
    const feedbackLower = feedback.toString().toLowerCase().trim();
    const comentarioLower = comentario.toString().toLowerCase().trim();
    const estadoLower = estado.toString().toLowerCase().trim();
    
    return (
        feedbackLower === 'n/a' ||
        feedbackLower === 'na' ||
        feedbackLower === 'no aplica' ||
        feedbackLower === 'no-aplica' ||
        feedbackLower.includes('no aplica') ||
        feedbackLower.includes('n/a') ||
        
        comentarioLower.includes('no aplica') ||
        comentarioLower.includes('n/a') ||
        
        estadoLower === 'n/a' ||
        estadoLower === 'na' ||
        estadoLower === 'no aplica' ||
        estadoLower.includes('no aplica')
    );
}

async function buscarSkapILC(codigoEmpleado) {
    try {
        console.log(`🔍 Buscando SKAP ILC para código: ${codigoEmpleado}`);
        
        const codigoBusqueda = codigoEmpleado.trim();
        console.log(`Buscando código ILC: "${codigoBusqueda}"`);
        
        const databaseUrl = FIREBASE_CONFIG_ILC.databaseURL;
        
        const usuariosResponse = await axios.get(`${databaseUrl}/usuarios.json`, {
            timeout: 15000
        });
        
        const usuarios = usuariosResponse.data;
        
        if (!usuarios) {
            return `❌ *NO ENCONTRADO - ILC*\n\n` +
                   `No hay usuarios registrados en la base de datos ILC.\n\n` +
                   `🔍 *Verifica:*\n` +
                   `• Que la base de datos tenga información\n` +
                   `• Contacta al administrador`;
        }
        
        let usuarioEncontrado = null;
        let usuarioIdEncontrado = null;
        
        for (const usuarioId in usuarios) {
            const usuario = usuarios[usuarioId];
            
            if (usuario.carnet && usuario.carnet.toString().trim() === codigoBusqueda) {
                usuarioEncontrado = usuario;
                usuarioIdEncontrado = usuarioId;
                console.log(`✅ Coincidencia exacta encontrada en carnet: ${usuario.carnet}`);
                break;
            }
        }
        
        if (!usuarioEncontrado) {
            console.log(`🔍 Buscando coincidencias parciales para: ${codigoBusqueda}`);
            
            for (const usuarioId in usuarios) {
                const usuario = usuarios[usuarioId];
                
                const camposABuscar = ['carnet', 'codigo', 'empleado', 'id', 'numero', 'legajo'];
                let encontrado = false;
                
                for (const campo of camposABuscar) {
                    if (usuario[campo] && usuario[campo].toString().includes(codigoBusqueda)) {
                        usuarioEncontrado = usuario;
                        usuarioIdEncontrado = usuarioId;
                        console.log(`✅ Coincidencia parcial encontrada en campo ${campo}: ${usuario[campo]}`);
                        encontrado = true;
                        break;
                    }
                }
                
                if (encontrado) break;
                
                if (usuario.nombre && usuario.nombre.toString().toLowerCase().includes(codigoBusqueda.toLowerCase())) {
                    usuarioEncontrado = usuario;
                    usuarioIdEncontrado = usuarioId;
                    console.log(`✅ Coincidencia encontrada en nombre: ${usuario.nombre}`);
                    break;
                }
                
                const usuarioStr = JSON.stringify(usuario).toLowerCase();
                if (usuarioStr.includes(codigoBusqueda.toLowerCase())) {
                    usuarioEncontrado = usuario;
                    usuarioIdEncontrado = usuarioId;
                    console.log(`✅ Coincidencia general en datos del usuario`);
                    break;
                }
            }
        }
        
        if (!usuarioEncontrado) {
            return `❌ *NO ENCONTRADO - ILC*\n\n` +
                   `El código *${codigoBusqueda}* no fue encontrado en la base de datos ILC.\n\n` +
                   `🔍 *Sugerencias:*\n` +
                   `• Verifica que el código sea correcto\n` +
                   `• Intenta con el código completo (ej: 76009949)\n` +
                   `• Intenta con solo los últimos dígitos (ej: 9949)\n` +
                   `• Revisa directamente: https://skapjarabe.web.app/usuario.html\n\n` +
                   `📞 *Para más información:*\n` +
                   `Contacta al supervisor del área`;
        }
        
        console.log(`✅ Usuario encontrado: ${usuarioEncontrado.nombre || 'Sin nombre'} (Carnet: ${usuarioEncontrado.carnet || 'Sin carnet'})`);
        
        let respuestas = {};
        try {
            const respuestasResponse = await axios.get(`${databaseUrl}/respuestas.json`, {
                timeout: 10000
            });
            respuestas = respuestasResponse.data || {};
            
            const respuestasUsuario = {};
            for (const respuestaId in respuestas) {
                if (respuestas[respuestaId].usuarioId === usuarioIdEncontrado) {
                    respuestasUsuario[respuestaId] = respuestas[respuestaId];
                }
            }
            respuestas = respuestasUsuario;
            console.log(`📊 Respuestas encontradas: ${Object.keys(respuestas).length}`);
        } catch (error) {
            console.log("No se pudieron obtener respuestas:", error.message);
        }
        
        let preguntas = {};
        try {
            const preguntasResponse = await axios.get(`${databaseUrl}/preguntas.json`, {
                timeout: 10000
            });
            preguntas = preguntasResponse.data || {};
            console.log(`📝 Preguntas encontradas: ${Object.keys(preguntas).length}`);
        } catch (error) {
            console.log("No se pudieron obtener preguntas:", error.message);
        }
        
        let habilidadesAvanzadas = [];
        let habilidadesIntermedias = [];
        let licenciaOperar = [];
        
        for (const respuestaId in respuestas) {
            const respuesta = respuestas[respuestaId];
            const preguntaId = respuesta.preguntaId;
            
            if (preguntas[preguntaId]) {
                const pregunta = preguntas[preguntaId];
                
                if (pregunta.tipoHabilidad === 'Habilidades avanzadas' || 
                    pregunta.tipoHabilidad?.includes('avanzada') || 
                    pregunta.categoria?.includes('avanzada')) {
                    habilidadesAvanzadas.push({
                        pregunta: pregunta.texto || pregunta.pregunta || 'Sin texto',
                        feedback: respuesta.feedback || 'unknown',
                        comentario: respuesta.comentario || '',
                        aprobada: respuesta.feedback === 'thumbs-up' || respuesta.estado === 'aprobado',
                        esNoAplica: esNoAplica(respuesta),
                        pilar: pregunta.pilar || 'Sin pilar',
                        criterioCierre: pregunta.criterioCierre || 'Sin criterio',
                        fechaApertura: respuesta.fechaApertura || respuesta.fecha || '',
                        fechaRegistro: respuesta.fecha || respuesta.fechaRegistro || ''
                    });
                } else if (pregunta.tipoHabilidad === 'Habilidades intermedias' || 
                          pregunta.tipoHabilidad?.includes('intermedia') || 
                          pregunta.categoria?.includes('intermedia')) {
                    habilidadesIntermedias.push({
                        pregunta: pregunta.texto || pregunta.pregunta || 'Sin texto',
                        feedback: respuesta.feedback || 'unknown',
                        comentario: respuesta.comentario || '',
                        aprobada: respuesta.feedback === 'thumbs-up' || respuesta.estado === 'aprobado',
                        esNoAplica: esNoAplica(respuesta),
                        pilar: pregunta.pilar || 'Sin pilar',
                        criterioCierre: pregunta.criterioCierre || 'Sin criterio',
                        fechaApertura: respuesta.fechaApertura || respuesta.fecha || '',
                        fechaRegistro: respuesta.fecha || respuesta.fechaRegistro || ''
                    });
                } else if (pregunta.tipoHabilidad === 'Licencia para operar' || 
                          pregunta.tipoHabilidad?.includes('licencia') || 
                          pregunta.categoria?.includes('licencia')) {
                    licenciaOperar.push({
                        pregunta: pregunta.texto || pregunta.pregunta || 'Sin texto',
                        feedback: respuesta.feedback || 'unknown',
                        comentario: respuesta.comentario || '',
                        aprobada: respuesta.feedback === 'thumbs-up' || respuesta.estado === 'aprobado',
                        esNoAplica: esNoAplica(respuesta),
                        pilar: pregunta.pilar || 'Sin pilar',
                        criterioCierre: pregunta.criterioCierre || 'Sin criterio',
                        fechaApertura: respuesta.fechaApertura || respuesta.fecha || '',
                        fechaCierre: respuesta.fechaCierre || ''
                    });
                }
            }
        }
        
        const habilidadesAvanzadasAplicables = habilidadesAvanzadas.filter(h => !h.esNoAplica);
        const habilidadesIntermediasAplicables = habilidadesIntermedias.filter(h => !h.esNoAplica);
        const licenciaOperarAplicables = licenciaOperar.filter(h => !h.esNoAplica);
        
        const porcentajeAvanzadas = habilidadesAvanzadasAplicables.length > 0 ? 
            Math.round((habilidadesAvanzadasAplicables.filter(h => h.aprobada).length / habilidadesAvanzadasAplicables.length) * 100) : 0;
        
        const porcentajeIntermedias = habilidadesIntermediasAplicables.length > 0 ? 
            Math.round((habilidadesIntermediasAplicables.filter(h => h.aprobada).length / habilidadesIntermediasAplicables.length) * 100) : 0;
        
        const porcentajeLicencia = licenciaOperarAplicables.length > 0 ? 
            Math.round((licenciaOperarAplicables.filter(h => h.aprobada).length / licenciaOperarAplicables.length) * 100) : 0;
        
        const noAplicaAvanzadas = habilidadesAvanzadas.filter(h => h.esNoAplica).length;
        const noAplicaIntermedias = habilidadesIntermedias.filter(h => h.esNoAplica).length;
        const noAplicaLicencia = licenciaOperar.filter(h => h.esNoAplica).length;
        
        const reprobadasAvanzadas = habilidadesAvanzadas.filter(h => !h.aprobada && !h.esNoAplica);
        const reprobadasIntermedias = habilidadesIntermedias.filter(h => !h.aprobada && !h.esNoAplica);
        const reprobadasLicencia = licenciaOperar.filter(h => !h.aprobada && !h.esNoAplica);
        
        let resultado = `📋 *INFORMACIÓN SKAP - ILC*\n\n`;
        resultado += `🔢 *Código:* ${usuarioEncontrado.carnet || codigoBusqueda}\n`;
        resultado += `👤 *Nombre:* ${usuarioEncontrado.nombre || 'No disponible'}\n`;
        
        if (usuarioEncontrado.area) {
            resultado += `🏭 *Área:* ${usuarioEncontrado.area}\n`;
        }
        if (usuarioEncontrado.areas && Array.isArray(usuarioEncontrado.areas)) {
            resultado += `📌 *Áreas:* ${usuarioEncontrado.areas.join(', ')}\n`;
        }
        if (usuarioEncontrado.departamento) {
            resultado += `🏢 *Departamento:* ${usuarioEncontrado.departamento}\n`;
        }
        if (usuarioEncontrado.puesto) {
            resultado += `💼 *Puesto:* ${usuarioEncontrado.puesto}\n`;
        }
        
        resultado += `\n📊 *ESTADÍSTICAS GENERALES:*\n`;
        resultado += `• Habilidades avanzadas: ${habilidadesAvanzadas.length} evaluaciones\n`;
        if (noAplicaAvanzadas > 0) {
            resultado += `  (${noAplicaAvanzadas} N/A - ${habilidadesAvanzadasAplicables.length} aplicables)\n`;
        }
        
        resultado += `• Habilidades intermedias: ${habilidadesIntermedias.length} evaluaciones\n`;
        if (noAplicaIntermedias > 0) {
            resultado += `  (${noAplicaIntermedias} N/A - ${habilidadesIntermediasAplicables.length} aplicables)\n`;
        }
        
        resultado += `• Licencia para operar: ${licenciaOperar.length} evaluaciones\n`;
        if (noAplicaLicencia > 0) {
            resultado += `  (${noAplicaLicencia} N/A - ${licenciaOperarAplicables.length} aplicables)\n`;
        }
        
        resultado += `\n🎯 *PORCENTAJES DE APROBACIÓN (excluyendo N/A):*\n`;
        resultado += `• Habilidades avanzadas: ${porcentajeAvanzadas}% (${habilidadesAvanzadasAplicables.filter(h => h.aprobada).length}/${habilidadesAvanzadasAplicables.length})\n`;
        resultado += `• Habilidades intermedias: ${porcentajeIntermedias}% (${habilidadesIntermediasAplicables.filter(h => h.aprobada).length}/${habilidadesIntermediasAplicables.length})\n`;
        resultado += `• Licencia para operar: ${porcentajeLicencia}% (${licenciaOperarAplicables.filter(h => h.aprobada).length}/${licenciaOperarAplicables.length})\n`;
        
        if (reprobadasAvanzadas.length > 0 || reprobadasIntermedias.length > 0 || reprobadasLicencia.length > 0) {
            resultado += `\n❌ *EVALUACIONES REPROBADAS:*\n`;
            
            if (reprobadasAvanzadas.length > 0) {
                resultado += `\n🔴 *HABILIDADES AVANZADAS (${reprobadasAvanzadas.length}):*\n`;
                reprobadasAvanzadas.forEach((repro, index) => {
                    resultado += `\n${index + 1}. 📝 *Pregunta:* ${repro.pregunta.substring(0, 80)}${repro.pregunta.length > 80 ? '...' : ''}\n`;
                    resultado += `   📌 *Pilar:* ${repro.pilar}\n`;
                    resultado += `   📋 *Criterio:* ${repro.criterioCierre}\n`;
                    if (repro.fechaApertura) {
                        const fechaApertura = moment(repro.fechaApertura).tz(TIMEZONE).format('DD/MM/YYYY HH:mm');
                        resultado += `   📅 *Fecha apertura:* ${fechaApertura}\n`;
                    } else if (repro.fechaRegistro) {
                        const fechaRegistro = moment(repro.fechaRegistro).tz(TIMEZONE).format('DD/MM/YYYY HH:mm');
                        resultado += `   📅 *Fecha registro:* ${fechaRegistro}\n`;
                    }
                    if (repro.comentario && repro.comentario.trim() !== '') {
                        resultado += `   💬 *Comentario:* ${repro.comentario.substring(0, 60)}${repro.comentario.length > 60 ? '...' : ''}\n`;
                    }
                });
            }
            
            if (reprobadasIntermedias.length > 0) {
                resultado += `\n🟠 *HABILIDADES INTERMEDIAS (${reprobadasIntermedias.length}):*\n`;
                reprobadasIntermedias.forEach((repro, index) => {
                    resultado += `\n${index + 1}. 📝 *Pregunta:* ${repro.pregunta.substring(0, 80)}${repro.pregunta.length > 80 ? '...' : ''}\n`;
                    resultado += `   📌 *Pilar:* ${repro.pilar}\n`;
                    resultado += `   📋 *Criterio:* ${repro.criterioCierre}\n`;
                    if (repro.fechaApertura) {
                        const fechaApertura = moment(repro.fechaApertura).tz(TIMEZONE).format('DD/MM/YYYY HH:mm');
                        resultado += `   📅 *Fecha apertura:* ${fechaApertura}\n`;
                    } else if (repro.fechaRegistro) {
                        const fechaRegistro = moment(repro.fechaRegistro).tz(TIMEZONE).format('DD/MM/YYYY HH:mm');
                        resultado += `   📅 *Fecha registro:* ${fechaRegistro}\n`;
                    }
                    if (repro.comentario && repro.comentario.trim() !== '') {
                        resultado += `   💬 *Comentario:* ${repro.comentario.substring(0, 60)}${repro.comentario.length > 60 ? '...' : ''}\n`;
                    }
                });
            }
            
            if (reprobadasLicencia.length > 0) {
                resultado += `\n🟢 *LICENCIA PARA OPERAR (${reprobadasLicencia.length}):*\n`;
                reprobadasLicencia.forEach((repro, index) => {
                    resultado += `\n${index + 1}. 📝 *Pregunta:* ${repro.pregunta.substring(0, 80)}${repro.pregunta.length > 80 ? '...' : ''}\n`;
                    resultado += `   📌 *Pilar:* ${repro.pilar}\n`;
                    resultado += `   📋 *Criterio:* ${repro.criterioCierre}\n`;
                    if (repro.fechaApertura) {
                        const fechaApertura = moment(repro.fechaApertura).tz(TIMEZONE).format('DD/MM/YYYY HH:mm');
                        resultado += `   📅 *Fecha apertura:* ${fechaApertura}\n`;
                    } else if (repro.fechaRegistro) {
                        const fechaRegistro = moment(repro.fechaRegistro).tz(TIMEZONE).format('DD/MM/YYYY HH:mm');
                        resultado += `   📅 *Fecha registro:* ${fechaRegistro}\n`;
                    }
                    if (repro.comentario && repro.comentario.trim() !== '') {
                        resultado += `   💬 *Comentario:* ${repro.comentario.substring(0, 60)}${repro.comentario.length > 60 ? '...' : ''}\n`;
                    }
                });
            }
        } else {
            resultado += `\n✅ *¡FELICIDADES!* No tienes evaluaciones reprobadas.\n`;
            resultado += `Todas tus evaluaciones están aprobadas o no aplican.\n`;
        }
        
        resultado += `\n📈 *ESTADO GENERAL:*\n`;
        if (licenciaOperarAplicables.length === 0) {
            resultado += `📝 *SIN EVALUACIONES APLICABLES*\n`;
        } else if (porcentajeLicencia >= 80) {
            resultado += `✅ *LICENCIA COMPLETA* - Listo para operar\n`;
        } else if (porcentajeLicencia >= 50) {
            resultado += `⚠️ *LICENCIA PARCIAL* - Necesita más evaluaciones\n`;
        } else {
            resultado += `❌ *LICENCIA INCOMPLETA* - Requiere capacitación\n`;
        }
        
        resultado += `\n⏰ *Consulta:* ${moment().tz(TIMEZONE).format('DD/MM/YYYY HH:mm')}\n`;
        resultado += `🔗 *Fuente:* Base de datos ILC`;
        
        return resultado;
        
    } catch (error) {
        console.error("Error detallado en buscarSkapILC:", error.message);
        console.error(error.stack);
        
        let mensajeError = "❌ *ERROR EN CONSULTA SKAP ILC*\n\n";
        mensajeError += `No se pudo realizar la búsqueda para el código: ${codigoEmpleado}\n\n`;
        mensajeError += "🔗 *Enlace:* https://skapjarabe.web.app/usuario.html\n";
        mensajeError += "⏰ *Hora:* " + moment().tz(TIMEZONE).format('DD/MM/YYYY HH:mm') + "\n\n";
        
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            mensajeError += "💡 *Causa:* No se pudo conectar a la base de datos\n";
            mensajeError += "• Verifica tu conexión a internet\n";
            mensajeError += "• El servidor puede estar temporalmente fuera de línea\n";
        } else if (error.response) {
            mensajeError += `💡 *Causa:* Error ${error.response.status}\n`;
            mensajeError += `• El servidor respondió con error\n`;
        } else {
            mensajeError += `💡 *Causa:* ${error.message}\n`;
        }
        
        mensajeError += "\n📞 *Contacta a Tu supervisor para más información*";
        
        return mensajeError;
    }
}

async function buscarSkapOUTS(codigoEmpleado) {
    try {
        console.log(`🔍 Buscando SKAP OUTS para código: ${codigoEmpleado}`);
        
        const codigoBusqueda = codigoEmpleado.trim();
        console.log(`Buscando código OUTS: "${codigoBusqueda}"`);
        
        const databaseUrl = FIREBASE_CONFIG_OUTS.databaseURL;
        
        const usuariosResponse = await axios.get(`${databaseUrl}/usuarios.json`, {
            timeout: 15000
        });
        
        const usuarios = usuariosResponse.data;
        
        if (!usuarios) {
            return `❌ *NO ENCONTRADO - OUTS*\n\n` +
                   `No hay usuarios registrados en la base de datos OUTS.\n\n` +
                   `🔍 *Verifica:*\n` +
                   `• Que la base de datos tenga información\n` +
                   `• Contacta al administrador`;
        }
        
        let usuarioEncontrado = null;
        let usuarioIdEncontrado = null;
        
        for (const usuarioId in usuarios) {
            const usuario = usuarios[usuarioId];
            
            if (usuario.carnet && usuario.carnet.toString().trim() === codigoBusqueda) {
                usuarioEncontrado = usuario;
                usuarioIdEncontrado = usuarioId;
                console.log(`✅ Coincidencia exacta encontrada en carnet: ${usuario.carnet}`);
                break;
            }
        }
        
        if (!usuarioEncontrado) {
            console.log(`🔍 Buscando coincidencias parciales para: ${codigoBusqueda}`);
            
            for (const usuarioId in usuarios) {
                const usuario = usuarios[usuarioId];
                
                const camposABuscar = ['carnet', 'codigo', 'empleado', 'id', 'numero', 'legajo'];
                let encontrado = false;
                
                for (const campo of camposABuscar) {
                    if (usuario[campo] && usuario[campo].toString().includes(codigoBusqueda)) {
                        usuarioEncontrado = usuario;
                        usuarioIdEncontrado = usuarioId;
                        console.log(`✅ Coincidencia parcial encontrada en campo ${campo}: ${usuario[campo]}`);
                        encontrado = true;
                        break;
                    }
                }
                
                if (encontrado) break;
                
                if (usuario.nombre && usuario.nombre.toString().toLowerCase().includes(codigoBusqueda.toLowerCase())) {
                    usuarioEncontrado = usuario;
                    usuarioIdEncontrado = usuarioId;
                    console.log(`✅ Coincidencia encontrada en nombre: ${usuario.nombre}`);
                    break;
                }
                
                const usuarioStr = JSON.stringify(usuario).toLowerCase();
                if (usuarioStr.includes(codigoBusqueda.toLowerCase())) {
                    usuarioEncontrado = usuario;
                    usuarioIdEncontrado = usuarioId;
                    console.log(`✅ Coincidencia general en datos del usuario`);
                    break;
                }
            }
        }
        
        if (!usuarioEncontrado) {
            return `❌ *NO ENCONTRADO - OUTS*\n\n` +
                   `El código *${codigoBusqueda}* no fue encontrado en la base de datos OUTS.\n\n` +
                   `🔍 *Sugerencias:*\n` +
                   `• Verifica que el código sea correcto\n` +
                   `• Intenta con el código completo (ej: 20120638)\n` +
                   `• Intenta con solo los últimos dígitos (ej: 0638)\n` +
                   `• Revisa directamente: https://skapjarabe.web.app/usuario2.html\n\n` +
                   `📞 *Para más información:*\n` +
                   `Contacta a *tu supervisor de turno*`;
        }
        
        console.log(`✅ Usuario encontrado: ${usuarioEncontrado.nombre || 'Sin nombre'} (Carnet: ${usuarioEncontrado.carnet || 'Sin carnet'})`);
        
        let respuestas = {};
        try {
            const respuestasResponse = await axios.get(`${databaseUrl}/respuestas.json`, {
                timeout: 10000
            });
            respuestas = respuestasResponse.data || {};
            
            const respuestasUsuario = {};
            for (const respuestaId in respuestas) {
                if (respuestas[respuestaId].usuarioId === usuarioIdEncontrado) {
                    respuestasUsuario[respuestaId] = respuestas[respuestaId];
                }
            }
            respuestas = respuestasUsuario;
            console.log(`📊 Respuestas encontradas: ${Object.keys(respuestas).length}`);
        } catch (error) {
            console.log("No se pudieron obtener respuestas:", error.message);
        }
        
        let preguntas = {};
        try {
            const preguntasResponse = await axios.get(`${databaseUrl}/preguntas.json`, {
                timeout: 10000
            });
            preguntas = preguntasResponse.data || {};
            console.log(`📝 Preguntas encontradas: ${Object.keys(preguntas).length}`);
        } catch (error) {
            console.log("No se pudieron obtener preguntas:", error.message);
        }
        
        let licenciaOperar = [];
        
        for (const respuestaId in respuestas) {
            const respuesta = respuestas[respuestaId];
            const preguntaId = respuesta.preguntaId;
            
            if (preguntas[preguntaId]) {
                const pregunta = preguntas[preguntaId];
                
                if (pregunta.tipoHabilidad === 'Licencia para operar' || 
                    pregunta.tipoHabilidad?.includes('licencia') || 
                    pregunta.categoria?.includes('licencia') ||
                    pregunta.tipo === 'licencia') {
                    licenciaOperar.push({
                        pregunta: pregunta.texto || pregunta.pregunta || 'Sin texto',
                        feedback: respuesta.feedback || 'unknown',
                        comentario: respuesta.comentario || '',
                        aprobada: respuesta.feedback === 'thumbs-up' || respuesta.estado === 'aprobado' || respuesta.aprobada === true,
                        esNoAplica: esNoAplica(respuesta),
                        pilar: pregunta.pilar || 'Sin pilar',
                        criterioCierre: pregunta.criterioCierre || 'Sin criterio',
                        fechaApertura: respuesta.fechaApertura || respuesta.fechaInicio || '',
                        fechaCierre: respuesta.fechaCierre || respuesta.fechaFin || '',
                        evaluador: respuesta.evaluador || ''
                    });
                }
            }
        }
        
        if (licenciaOperar.length === 0 && Object.keys(respuestas).length > 0) {
            console.log("⚠️ No se encontraron licencias específicas, mostrando todas las respuestas como licencias");
            for (const respuestaId in respuestas) {
                const respuesta = respuestas[respuestaId];
                const preguntaId = respuesta.preguntaId;
                
                if (preguntas[preguntaId]) {
                    const pregunta = preguntas[preguntaId];
                    licenciaOperar.push({
                        pregunta: pregunta.texto || pregunta.pregunta || 'Sin texto',
                        feedback: respuesta.feedback || 'unknown',
                        comentario: respuesta.comentario || '',
                        aprobada: respuesta.feedback === 'thumbs-up' || respuesta.estado === 'aprobado' || respuesta.aprobada === true,
                        esNoAplica: esNoAplica(respuesta),
                        pilar: pregunta.pilar || 'Sin pilar',
                        criterioCierre: pregunta.criterioCierre || 'Sin criterio',
                        fechaApertura: respuesta.fechaApertura || respuesta.fechaInicio || '',
                        fechaCierre: respuesta.fechaCierre || respuesta.fechaFin || '',
                        evaluador: respuesta.evaluador || ''
                    });
                }
            }
        }
        
        const licenciaOperarAplicables = licenciaOperar.filter(h => !h.esNoAplica);
        
        const porcentajeLicencia = licenciaOperarAplicables.length > 0 ? 
            Math.round((licenciaOperarAplicables.filter(h => h.aprobada).length / licenciaOperarAplicables.length) * 100) : 0;
        
        const noAplicaLicencia = licenciaOperar.filter(h => h.esNoAplica).length;
        
        const reprobadasLicencia = licenciaOperar.filter(h => !h.aprobada && !h.esNoAplica);
        
        let resultado = `📋 *INFORMACIÓN SKAP - OUTS*\n\n`;
        resultado += `🔢 *Código:* ${usuarioEncontrado.carnet || codigoBusqueda}\n`;
        resultado += `👤 *Nombre:* ${usuarioEncontrado.nombre || 'No disponible'}\n`;
        
        if (usuarioEncontrado.area) {
            resultado += `🏭 *Área:* ${usuarioEncontrado.area}\n`;
        }
        if (usuarioEncontrado.areas && Array.isArray(usuarioEncontrado.areas)) {
            resultado += `📌 *Áreas:* ${usuarioEncontrado.areas.join(', ')}\n`;
        }
        if (usuarioEncontrado.departamento) {
            resultado += `🏢 *Departamento:* ${usuarioEncontrado.departamento}\n`;
        }
        if (usuarioEncontrado.puesto) {
            resultado += `💼 *Puesto:* ${usuarioEncontrado.puesto}\n`;
        }
        
        resultado += `\n📊 *ESTADÍSTICAS DE LICENCIA:*\n`;
        resultado += `• Total evaluaciones: ${licenciaOperar.length}\n`;
        if (noAplicaLicencia > 0) {
            resultado += `  (${noAplicaLicencia} N/A - ${licenciaOperarAplicables.length} aplicables)\n`;
        }
        resultado += `• Aprobadas: ${licenciaOperarAplicables.filter(h => h.aprobada).length}\n`;
        resultado += `• Pendientes: ${licenciaOperarAplicables.filter(h => !h.aprobada).length}\n`;
        resultado += `• Porcentaje de aprobación (excluyendo N/A): ${porcentajeLicencia}%\n`;
        
        if (reprobadasLicencia.length > 0) {
            resultado += `\n❌ *LICENCIAS REPROBADAS (${reprobadasLicencia.length}):*\n`;
            reprobadasLicencia.forEach((repro, index) => {
                resultado += `\n${index + 1}. 📝 *Pregunta:* ${repro.pregunta.substring(0, 80)}${repro.pregunta.length > 80 ? '...' : ''}\n`;
                resultado += `   📌 *Pilar:* ${repro.pilar}\n`;
                resultado += `   📋 *Criterio:* ${repro.criterioCierre}\n`;
                
                if (repro.fechaApertura) {
                    const fechaApertura = moment(repro.fechaApertura).tz(TIMEZONE).format('DD/MM/YYYY HH:mm');
                    resultado += `   📅 *Fecha apertura:* ${fechaApertura}\n`;
                } else if (repro.fechaRegistro) {
                    const fechaRegistro = moment(repro.fechaRegistro).tz(TIMEZONE).format('DD/MM/YYYY HH:mm');
                    resultado += `   📅 *Fecha registro:* ${fechaRegistro}\n`;
                }
                
                if (repro.fechaCierre) {
                    const fechaCierre = moment(repro.fechaCierre).tz(TIMEZONE).format('DD/MM/YYYY HH:mm');
                    resultado += `   📅 *Fecha cierre:* ${fechaCierre}\n`;
                }
                
                if (repro.evaluador) {
                    resultado += `   👤 *Evaluador:* ${repro.evaluador}\n`;
                }
                
                if (repro.comentario && repro.comentario.trim() !== '') {
                    resultado += `   💬 *Comentario:* ${repro.comentario.substring(0, 60)}${repro.comentario.length > 60 ? '...' : ''}\n`;
                }
            });
        } else {
            resultado += `\n✅ *¡FELICIDADES!* No tienes licencias reprobadas.\n`;
            resultado += `Todas tus evaluaciones están aprobadas o no aplican.\n`;
        }
        
        resultado += `\n📈 *ESTADO DE LICENCIA:*\n`;
        if (licenciaOperarAplicables.length === 0) {
            resultado += `📝 *SIN EVALUACIONES APLICABLES*\n`;
        } else if (porcentajeLicencia >= 80 && licenciaOperarAplicables.length >= 3) {
            resultado += `✅ *LICENCIA COMPLETA* - Autorizado para operar\n`;
        } else if (porcentajeLicencia >= 50) {
            resultado += `⚠️ *LICENCIA PARCIAL* - Requiere supervisión\n`;
        } else if (licenciaOperarAplicables.length > 0) {
            resultado += `❌ *LICENCIA INCOMPLETA* - No autorizado para operar\n`;
        } else {
            resultado += `📝 *SIN EVALUACIONES APLICABLES* - Requiere evaluación inicial\n`;
        }
        
        resultado += `\n⏰ *Consulta:* ${moment().tz(TIMEZONE).format('DD/MM/YYYY HH:mm')}\n`;
        resultado += `🔗 *Fuente:* Base de datos OUTS`;
        
        return resultado;
        
    } catch (error) {
        console.error("Error detallado en buscarSkapOUTS:", error.message);
        console.error(error.stack);
        
        let mensajeError = "❌ *ERROR EN CONSULTA SKAP OUTS*\n\n";
        mensajeError += `No se pudo realizar la búsqueda para el código: ${codigoEmpleado}\n\n`;
        mensajeError += "🔗 *Enlace:* https://skapjarabe.web.app/usuario2.html\n";
        mensajeError += "⏰ *Hora:* " + moment().tz(TIMEZONE).format('DD/MM/YYYY HH:mm') + "\n\n";
        
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            mensajeError += "💡 *Causa:* No se pudo conectar a la base de datos\n";
            mensajeError += "• Verifica tu conexión a internet\n";
            mensajeError += "• El servidor puede estar temporalmente fuera de línea\n";
        } else if (error.response) {
            mensajeError += `💡 *Causa:* Error ${error.response.status}\n`;
            mensajeError += `• El servidor respondió con error\n`;
        } else {
            mensajeError += `💡 *Causa:* ${error.message}\n`;
        }
        
        mensajeError += "\n📞 *Contacta al supervisor de turno para más información*";
        
        return mensajeError;
    }
}

async function buscarEnPaginaDirecta(codigoEmpleado, tipo) {
    try {
        console.log(`🔍 Búsqueda alternativa en HTML para ${tipo}: ${codigoEmpleado}`);
        
        const url = tipo === 'ILC' ? 'https://skapjarabe.web.app/usuario.html' : 'https://skapjarabe.web.app/usuario2.html';
        
        const response = await axios.get(url, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        
        const $ = cheerio.load(response.data);
        
        const codigoBusqueda = codigoEmpleado.trim();
        const paginaCompleta = response.data;
        
        if (!paginaCompleta.includes(codigoBusqueda)) {
            return `❌ *NO ENCONTRADO - ${tipo}*\n\n` +
                   `El código *${codigoBusqueda}* no fue encontrado en la página.\n\n` +
                   `🔗 *URL:* ${url}\n` +
                   `⏰ *Hora:* ${moment().tz(TIMEZONE).format('DD/MM/YYYY HH:mm')}`;
        }
        
        console.log(`✅ Código ${codigoBusqueda} encontrado en HTML de ${tipo}`);
        
        let resultado = `📋 *INFORMACIÓN SKAP - ${tipo} (HTML)*\n\n`;
        resultado += `🔢 *Código:* ${codigoBusqueda}\n`;
        resultado += `✅ *Código encontrado en el sistema*\n\n`;
        
        resultado += `ℹ️ *Información disponible:*\n`;
        resultado += `El código existe en la base de datos.\n`;
        resultado += `Para ver información detallada, visita:\n`;
        resultado += `${url}\n\n`;
        
        resultado += `⏰ *Consulta:* ${moment().tz(TIMEZONE).format('DD/MM/YYYY HH:mm')}\n`;
        resultado += `🔗 *Fuente:* Página web directa`;
        
        return resultado;
        
    } catch (error) {
        console.error(`Error en búsqueda HTML para ${tipo}:`, error.message);
        return `❌ *ERROR BÚSQUEDA HTML - ${tipo}*\n\n` +
               `Error técnico: ${error.message}\n\n` +
               `🔗 *URL:* ${tipo === 'ILC' ? 'https://skapjarabe.web.app/usuario.html' : 'https://skapjarabe.web.app/usuario2.html'}`;
    }
}

async function iniciarProgramacion(message) {
    const userId = message.from;
    
    if (scheduledMessages.length > 0) {
        let mensajeOpciones = "📅 *MENSAJES PROGRAMADOS EXISTENTES*\n\n";
        
        scheduledMessages.forEach((msg, index) => {
            mensajeOpciones += `${index + 1}. Horas: ${msg.horas.join(', ')} - Creado: ${moment(msg.fechaCreacion).tz(TIMEZONE).format('DD/MM/YYYY')}\n`;
        });
        
        mensajeOpciones += "\n*Selecciona una opción:*\n\n";
        mensajeOpciones += "1️⃣ - Editar mensaje actual\n";
        mensajeOpciones += "2️⃣ - Crear nuevo registro con horas diferentes\n";
        mensajeOpciones += "3️⃣ - Eliminar mensaje programado\n";
        mensajeOpciones += "4️⃣ - Cancelar\n\n";
        mensajeOpciones += "Envía el número de la opción (1-4)";
        
        await message.reply(mensajeOpciones);
        userStates.set(userId, { estado: 'seleccionar_opcion_existente', datos: {} });
    } else {
        await iniciarNuevaProgramacion(message);
    }
}

async function iniciarNuevaProgramacion(message) {
    const userId = message.from;
    
    await message.reply(
        "🔐 *PROGRAMACIÓN DE MENSAJES*\n\n" +
        "Esta opción es solo para administradores.\n\n" +
        "Por favor envía tus credenciales en el formato:\n" +
        "`usuario:contraseña`\n\n" +
        "Ejemplo: admin:admin123\n\n" +
        "O envía *cancelar* para regresar al menú principal."
    );
    
    userStates.set(userId, {
        estado: 'esperando_credenciales',
        datos: { esNuevo: true }
    });
}

async function manejarCredenciales(message, userId, estadoUsuario) {
    const texto = message.body.trim();
    
    if (texto.includes(':')) {
        const partes = texto.split(':');
        const usuario = partes[0].trim();
        const contrasena = partes[1].trim();
        
        if (usuario === ADMIN_CREDENTIALS.username && contrasena === ADMIN_CREDENTIALS.password) {
            estadoUsuario.estado = 'seleccionar_tipo_contenido';
            userStates.set(userId, estadoUsuario);
            
            await message.reply(
                "✅ *Credenciales correctas*\n\n" +
                "¿Qué tipo de contenido deseas programar?\n\n" +
                "1️⃣ - Imagen (JPG, PNG, GIF)\n" +
                "2️⃣ - Video (MP4, AVI, MOV)\n" +
                "3️⃣ - Documento (PDF, DOCX)\n" +
                "4️⃣ - Solo texto (sin archivo adjunto)\n\n" +
                "Envía el número de la opción (1-4)"
            );
        } else {
            await message.reply(
                "❌ *Credenciales incorrectas*\n\n" +
                "Lo sentimos, tus credenciales no son correctas.\n\n" +
                "Por favor ingresa de nuevo las credenciales.\n" +
                "Formato: usuario:contraseña\n\n" +
                "O envía *cancelar* para regresar al menú."
            );
        }
    } else {
        await message.reply("Formato incorrecto. Usa: usuario:contraseña");
    }
}

async function manejarTipoContenido(message, userId, estadoUsuario) {
    const opcion = message.body.trim();
    
    if (opcion === '1') {
        estadoUsuario.datos.tipoContenido = 'imagen';
        estadoUsuario.estado = 'esperando_archivo';
        userStates.set(userId, estadoUsuario);
        
        await message.reply(
            "📸 *PROGRAMAR IMAGEN*\n\n" +
            "Ahora envía la imagen que deseas programar:\n" +
            "(Puede ser una foto, imagen, sticker, etc.)\n\n" +
            "O envía *omitir* para programar solo texto."
        );
        
    } else if (opcion === '2') {
        estadoUsuario.datos.tipoContenido = 'video';
        estadoUsuario.estado = 'esperando_archivo';
        userStates.set(userId, estadoUsuario);
        
        await message.reply(
            "🎬 *PROGRAMAR VIDEO*\n\n" +
            "Ahora envía el video que deseas programar:\n" +
            "(Formatos soportados: MP4, AVI, MOV)\n\n" +
            "O envía *omitir* para programar solo texto."
        );
        
    } else if (opcion === '3') {
        estadoUsuario.datos.tipoContenido = 'documento';
        estadoUsuario.estado = 'esperando_archivo';
        userStates.set(userId, estadoUsuario);
        
        await message.reply(
            "📄 *PROGRAMAR DOCUMENTO*\n\n" +
            "Ahora envía el documento que deseas programar:\n" +
            "(Formatos soportados: PDF, DOCX)\n\n" +
            "O envía *omitir* para programar solo texto."
        );
        
    } else if (opcion === '4') {
        estadoUsuario.datos.tipoContenido = 'texto';
        estadoUsuario.datos.archivoInfo = null;
        estadoUsuario.estado = 'esperando_mensaje';
        userStates.set(userId, estadoUsuario);
        
        await message.reply(
            "📝 *PROGRAMAR SOLO TEXTO*\n\n" +
            "Ahora envía el mensaje de texto que quieres programar:"
        );
        
    } else {
        await message.reply("❌ Opción inválida. Por favor envía un número del 1 al 4.");
    }
}

async function manejarArchivo(message, userId, estadoUsuario) {
    const texto = message.body.trim().toLowerCase();
    
    if (texto === 'omitir') {
        estadoUsuario.datos.archivoInfo = null;
        estadoUsuario.estado = 'esperando_mensaje';
        userStates.set(userId, estadoUsuario);
        
        await message.reply(
            "✅ *Sin archivo adjunto*\n\n" +
            "Ahora envía el mensaje de texto que quieres programar:"
        );
        return;
    }
    
    if (message.hasMedia) {
        try {
            const media = await message.downloadMedia();
            let tipo = estadoUsuario.datos.tipoContenido;
            
            if (!tipo) {
                if (media.mimetype.includes('image')) {
                    tipo = 'imagen';
                } else if (media.mimetype.includes('video')) {
                    tipo = 'video';
                } else if (media.mimetype.includes('pdf') || media.mimetype.includes('document')) {
                    tipo = 'documento';
                } else {
                    tipo = 'documento';
                }
            }
            
            const archivoInfo = await guardarArchivo(media, userId, tipo);
            
            estadoUsuario.datos.archivoInfo = archivoInfo;
            estadoUsuario.datos.imagenPath = archivoInfo.ruta;
            estadoUsuario.estado = 'esperando_mensaje';
            userStates.set(userId, estadoUsuario);
            
            await message.reply(
                `✅ *${tipo.toUpperCase()} recibido correctamente*\n\n` +
                "Ahora envía el mensaje de texto que quieres que acompañe al archivo.\n\n" +
                "O envía *omitir* si solo quieres enviar el archivo sin texto."
            );
        } catch (error) {
            await message.reply("❌ Error al procesar el archivo. Intenta nuevamente.");
        }
    } else if (texto !== 'omitir') {
        await message.reply("❌ No se detectó ningún archivo. Por favor envía un archivo o escribe *omitir*.");
    }
}

async function manejarMensajeTexto(message, userId, estadoUsuario) {
    const texto = message.body.trim();
    
    if (texto.toLowerCase() === 'omitir') {
        estadoUsuario.datos.mensaje = "";
    } else {
        estadoUsuario.datos.mensaje = texto;
    }
    
    estadoUsuario.estado = 'seleccionar_cantidad_horas';
    userStates.set(userId, estadoUsuario);
    
    await message.reply(
        "✅ *Mensaje configurado*\n\n" +
        "¿Cuántas horas al día quieres programar?\n\n" +
        "1️⃣ - 1 hora al día\n" +
        "2️⃣ - 2 horas al día\n" +
        "3️⃣ - 3 horas al día\n\n" +
        "Envía el número de la opción (1-3)"
    );
}

async function manejarCantidadHoras(message, userId, estadoUsuario) {
    const opcion = message.body.trim();
    
    if (opcion === '1') {
        estadoUsuario.datos.cantidadHoras = 1;
        estadoUsuario.estado = 'esperando_hora_unica';
        userStates.set(userId, estadoUsuario);
        
        await message.reply(
            "⏰ *PROGRAMAR 1 HORA*\n\n" +
            "Envía la hora en la que quieres que se envíe el mensaje.\n\n" +
            "*Ejemplos:*\n" +
            "• 06:00\n" +
            "• 8:30 am\n" +
            "• 18:00 pm\n" +
            "• 9:00"
        );
        
    } else if (opcion === '2') {
        estadoUsuario.datos.cantidadHoras = 2;
        estadoUsuario.estado = 'esperando_horas';
        userStates.set(userId, estadoUsuario);
        
        await message.reply(
            "⏰ *PROGRAMAR 2 HORAS*\n\n" +
            "Envía las 2 horas en las que quieres que se envíe el mensaje.\n\n" +
            "*Ejemplos:*\n" +
            "• 06:00 y 18:00\n" +
            "• 06:00 am y 18:00 pm\n" +
            "• 8:30 y 16:45\n" +
            "• 9:00 am y 5:00 pm\n\n" +
            "Siempre separa las dos horas con la palabra *y*"
        );
        
    } else if (opcion === '3') {
        estadoUsuario.datos.cantidadHoras = 3;
        estadoUsuario.estado = 'esperando_tres_horas';
        userStates.set(userId, estadoUsuario);
        
        await message.reply(
            "⏰ *PROGRAMAR 3 HORAS*\n\n" +
            "Envía las 3 horas en las que quieres que se envíe el mensaje.\n\n" +
            "*Ejemplos:*\n" +
            "• 06:00, 12:00 y 18:00\n" +
            "• 8:00 am, 12:30 pm y 17:00\n" +
            "• 9:00, 14:00 y 19:00\n\n" +
            "Separa las tres horas con comas y la última con 'y'"
        );
        
    } else {
        await message.reply("❌ Opción inválida. Por favor envía un número del 1 al 3.");
    }
}

async function manejarHoraUnica(message, userId, estadoUsuario) {
    const horaStr = message.body.trim();
    const horaParseada = parsearHora(horaStr);
    
    if (horaParseada) {
        estadoUsuario.datos.horas = [horaParseada];
        estadoUsuario.estado = 'seleccionar_frecuencia';
        userStates.set(userId, estadoUsuario);
        
        await message.reply(
            "✅ *Hora configurada correctamente*\n\n" +
            "*Hora programada:* " + horaParseada + "\n\n" +
            "¿Con qué frecuencia quieres que se envíe?\n\n" +
            "1️⃣ - *Una sola vez* (mañana a esta hora)\n" +
            "2️⃣ - *Diariamente* (todos los días)\n" +
            "3️⃣ - *Personalizado* (elegir fechas inicio/fin)\n\n" +
            "Envía el número de la opción (1-3)"
        );
    } else {
        await message.reply(`❌ Formato de hora inválido: "${horaStr}"\n\nUsa formato HH:MM o HH:MM am/pm`);
    }
}

async function manejarHorasDos(message, userId, estadoUsuario) {
    const texto = message.body.trim().toLowerCase();
    const horas = texto.split(' y ');
    
    if (horas.length !== 2) {
        await message.reply("❌ Debes enviar exactamente DOS horas separadas por 'y'");
        return;
    }
    
    const horasParseadas = [];
    
    for (let horaStr of horas) {
        const horaParseada = parsearHora(horaStr.trim());
        if (horaParseada) {
            horasParseadas.push(horaParseada);
        } else {
            await message.reply(`❌ Formato de hora inválido: "${horaStr}"\n\nUsa formato HH:MM o HH:MM am/pm`);
            return;
        }
    }
    
    estadoUsuario.datos.horas = horasParseadas;
    estadoUsuario.estado = 'seleccionar_frecuencia';
    userStates.set(userId, estadoUsuario);
    
    await message.reply(
        "✅ *Horas configuradas correctamente*\n\n" +
        "*Horas programadas:* " + horasParseadas.join(' y ') + "\n\n" +
        "¿Con qué frecuencia quieres que se envíe?\n\n" +
        "1️⃣ - *Una sola vez* (mañana a estas horas)\n" +
        "2️⃣ - *Diariamente* (todos los días)\n" +
        "3️⃣ - *Personalizado* (elegir fechas inicio/fin)\n\n" +
        "Envía el número de la opción (1-3)"
    );
}

async function manejarTresHoras(message, userId, estadoUsuario) {
    const texto = message.body.trim().toLowerCase();
    
    const partes = texto.split(' y ');
    let horasArray = [];
    
    if (partes.length === 2) {
        const primerasHoras = partes[0].split(',').map(h => h.trim());
        const ultimaHora = partes[1].trim();
        horasArray = [...primerasHoras, ultimaHora];
    } else {
        horasArray = texto.split(',').map(h => h.trim());
    }
    
    if (horasArray.length !== 3) {
        await message.reply("❌ Debes enviar exactamente TRES horas\n\nEjemplo: 06:00, 12:00 y 18:00");
        return;
    }
    
    const horasParseadas = [];
    
    for (let horaStr of horasArray) {
        const horaParseada = parsearHora(horaStr);
        if (horaParseada) {
            horasParseadas.push(horaParseada);
        } else {
            await message.reply(`❌ Formato de hora inválido: "${horaStr}"\n\nUsa formato HH:MM o HH:MM am/pm`);
            return;
        }
    }
    
    estadoUsuario.datos.horas = horasParseadas;
    estadoUsuario.estado = 'seleccionar_frecuencia';
    userStates.set(userId, estadoUsuario);
    
    await message.reply(
        "✅ *Horas configuradas correctamente*\n\n" +
        "*Horas programadas:* " + horasParseadas.join(', ') + "\n\n" +
        "¿Con qué frecuencia quieres que se envíe?\n\n" +
        "1️⃣ - *Una sola vez* (mañana a estas horas)\n" +
        "2️⃣ - *Diariamente* (todos los días)\n" +
        "3️⃣ - *Personalizado* (elegir fechas inicio/fin)\n\n" +
        "Envía el número de la opción (1-3)"
    );
}

async function manejarFrecuencia(message, userId, estadoUsuario) {
    const opcion = message.body.trim();
    
    if (opcion === '1') {
        estadoUsuario.datos.frecuencia = 'una_vez';
        estadoUsuario.datos.fechaInicio = new Date();
        estadoUsuario.datos.fechaFin = new Date();
        
        estadoUsuario.estado = 'esperando_confirmacion_grupos';
        userStates.set(userId, estadoUsuario);
        
        await message.reply(
            "✅ *Frecuencia configurada: Una sola vez*\n\n" +
            "¿Quieres que el mensaje se envíe a *todos* los grupos?\n\n" +
            "1️⃣ - *Sí*, enviar a todos los grupos\n" +
            "2️⃣ - *No*, seleccionar grupos específicos"
        );
        
    } else if (opcion === '2') {
        estadoUsuario.datos.frecuencia = 'diario';
        
        estadoUsuario.estado = 'esperando_confirmacion_grupos';
        userStates.set(userId, estadoUsuario);
        
        await message.reply(
            "✅ *Frecuencia configurada: Diariamente*\n\n" +
            "¿Quieres que el mensaje se envíe a *todos* los grupos?\n\n" +
            "1️⃣ - *Sí*, enviar a todos los grupos\n" +
            "2️⃣ - *No*, seleccionar grupos específicos"
        );
        
    } else if (opcion === '3') {
        estadoUsuario.datos.frecuencia = 'personalizado';
        estadoUsuario.estado = 'esperando_fecha_inicio';
        userStates.set(userId, estadoUsuario);
        
        await message.reply(
            "📅 *FRECUENCIA PERSONALIZADA*\n\n" +
            "Envía la fecha de INICIO en formato DD/MM/YYYY\n\n" +
            "*Ejemplo:* 15/01/2024\n\n" +
            "O envía *hoy* para empezar hoy"
        );
        
    } else {
        await message.reply("❌ Opción inválida. Por favor envía un número del 1 al 3.");
    }
}

async function manejarFechaInicio(message, userId, estadoUsuario) {
    const texto = message.body.trim().toLowerCase();
    
    let fechaInicio;
    
    if (texto === 'hoy') {
        fechaInicio = new Date();
    } else {
        const regexFecha = /^(\d{2})\/(\d{2})\/(\d{4})$/;
        const match = texto.match(regexFecha);
        
        if (match) {
            const dia = parseInt(match[1]);
            const mes = parseInt(match[2]) - 1;
            const anio = parseInt(match[3]);
            
            fechaInicio = new Date(anio, mes, dia);
            
            if (fechaInicio.getDate() !== dia || fechaInicio.getMonth() !== mes) {
                await message.reply("❌ Fecha inválida. Verifica el día y mes.");
                return;
            }
            
            const hoy = new Date();
            hoy.setHours(0, 0, 0, 0);
            if (fechaInicio < hoy) {
                await message.reply("❌ No puedes programar para fechas pasadas.");
                return;
            }
        } else {
            await message.reply("❌ Formato de fecha inválido. Usa DD/MM/YYYY");
            return;
        }
    }
    
    estadoUsuario.datos.fechaInicio = fechaInicio;
    estadoUsuario.estado = 'esperando_fecha_fin';
    userStates.set(userId, estadoUsuario);
    
    await message.reply(
        "✅ *Fecha de inicio configurada*\n\n" +
        "Envía la fecha de FIN en formato DD/MM/YYYY\n\n" +
        "*Ejemplo:* 31/12/2024\n\n" +
        "O envía *indefinido* para que no tenga fecha de fin"
    );
}

async function manejarFechaFin(message, userId, estadoUsuario) {
    const texto = message.body.trim().toLowerCase();
    
    let fechaFin = null;
    
    if (texto === 'indefinido') {
        fechaFin = null;
    } else {
        const regexFecha = /^(\d{2})\/(\d{2})\/(\d{4})$/;
        const match = texto.match(regexFecha);
        
        if (match) {
            const dia = parseInt(match[1]);
            const mes = parseInt(match[2]) - 1;
            const anio = parseInt(match[3]);
            
            fechaFin = new Date(anio, mes, dia);
            
            if (fechaFin.getDate() !== dia || fechaFin.getMonth() !== mes) {
                await message.reply("❌ Fecha inválida. Verifica el día y mes.");
                return;
            }
            
            if (fechaFin < estadoUsuario.datos.fechaInicio) {
                await message.reply("❌ La fecha de fin debe ser después de la fecha de inicio.");
                return;
            }
        } else {
            await message.reply("❌ Formato de fecha inválido. Usa DD/MM/YYYY o escribe *indefinido*");
            return;
        }
    }
    
    estadoUsuario.datos.fechaFin = fechaFin;
    estadoUsuario.estado = 'esperando_confirmacion_grupos';
    userStates.set(userId, estadoUsuario);
    
    await message.reply(
        "✅ *Fechas configuradas correctamente*\n\n" +
        "¿Quieres que el mensaje se envíe a *todos* los grupos?\n\n" +
        "1️⃣ - *Sí*, enviar a todos los grupos\n" +
        "2️⃣ - *No*, seleccionar grupos específicos"
    );
}

async function manejarConfirmacionGrupos(message, userId, estadoUsuario) {
    const opcion = message.body.trim();
    
    if (opcion === '1' || opcion.toLowerCase() === 'sí' || opcion.toLowerCase() === 'si') {
        estadoUsuario.datos.enviarATodos = true;
        estadoUsuario.estado = 'mostrando_vista_previa';
        userStates.set(userId, estadoUsuario);
        
        const preview = generarVistaPrevia(estadoUsuario.datos);
        await message.reply(preview + "\n\n¿Deseas guardar esta programación?\n\n1️⃣ - Sí, guardar\n2️⃣ - No, cancelar");
        
    } else if (opcion === '2' || opcion.toLowerCase() === 'no') {
        estadoUsuario.datos.enviarATodos = false;
        estadoUsuario.estado = 'seleccionando_grupos';
        userStates.set(userId, estadoUsuario);
        
        const grupos = await obtenerGrupos();
        availableGroups = grupos;
        
        if (grupos.length === 0) {
            await message.reply("❌ No hay grupos disponibles. El bot no está en ningún grupo.");
            userStates.delete(userId);
            await enviarMenu(message);
            return;
        }
        
        let listaGrupos = "📋 *GRUPOS DISPONIBLES*\n\n";
        grupos.forEach((grupo, index) => {
            listaGrupos += `${index + 1} - ${grupo.name}\n`;
        });
        
        listaGrupos += "\nEnvía los *números* de los grupos (separados por coma):\n";
        listaGrupos += "Ejemplo: 1,3,5\n";
        listaGrupos += "O envía *todos* para seleccionar todos los grupos";
        
        await message.reply(listaGrupos);
        
    } else {
        await message.reply("Por favor selecciona:\n1 - Sí\n2 - No");
    }
}

async function manejarSeleccionGrupos(message, userId, estadoUsuario) {
    const texto = message.body.trim().toLowerCase();
    
    if (texto === 'todos') {
        estadoUsuario.datos.gruposSeleccionados = availableGroups.map(g => g.id._serialized);
    } else {
        const numeros = texto.split(',').map(num => parseInt(num.trim()) - 1);
        const gruposValidos = [];
        
        for (const num of numeros) {
            if (num >= 0 && num < availableGroups.length) {
                gruposValidos.push(availableGroups[num].id._serialized);
            }
        }
        
        if (gruposValidos.length === 0) {
            await message.reply("❌ No seleccionaste grupos válidos. Intenta nuevamente.");
            return;
        }
        
        estadoUsuario.datos.gruposSeleccionados = gruposValidos;
    }
    
    estadoUsuario.estado = 'mostrando_vista_previa';
    userStates.set(userId, estadoUsuario);
    
    const preview = generarVistaPrevia(estadoUsuario.datos);
    await message.reply(preview + "\n\n*¿Deseas guardar esta programación?*\n\n1️⃣ - Sí, guardar\n2️⃣ - No, cancelar");
}

async function guardarProgramacion(message, userId, estadoUsuario) {
    const programacion = {
        archivoInfo: estadoUsuario.datos.archivoInfo,
        imagenPath: estadoUsuario.datos.imagenPath || (estadoUsuario.datos.archivoInfo ? estadoUsuario.datos.archivoInfo.ruta : null),
        mensaje: estadoUsuario.datos.mensaje || "",
        horas: estadoUsuario.datos.horas,
        frecuencia: estadoUsuario.datos.frecuencia || 'diario',
        fechaInicio: estadoUsuario.datos.fechaInicio || new Date(),
        fechaFin: estadoUsuario.datos.fechaFin || null,
        grupos: estadoUsuario.datos.enviarATodos ? 'todos' : estadoUsuario.datos.gruposSeleccionados,
        fechaCreacion: new Date(),
        creadoPor: userId,
        ultimoEnvio: null,
        enviosHoy: []
    };
    
    if (estadoUsuario.datos.indiceEditar !== undefined) {
        const programacionAntigua = scheduledMessages[estadoUsuario.datos.indiceEditar];
        if (programacionAntigua.archivoInfo && programacionAntigua.archivoInfo.ruta !== programacion.archivoInfo?.ruta) {
            try {
                if (fs.existsSync(programacionAntigua.archivoInfo.ruta)) {
                    fs.unlinkSync(programacionAntigua.archivoInfo.ruta);
                }
            } catch (error) {
            }
        }
        
        scheduledMessages[estadoUsuario.datos.indiceEditar] = programacion;
    } else {
        scheduledMessages.push(programacion);
    }
    
    try {
        const archivoProgramaciones = path.join(__dirname, 'programaciones.json');
        fs.writeFileSync(archivoProgramaciones, JSON.stringify(scheduledMessages, null, 2));
    } catch (error) {
    }
    
    await message.reply(
        "✅ *PROGRAMACIÓN GUARDADA EXITOSAMENTE*\n\n" +
        "El mensaje se enviará automáticamente a las horas especificadas.\n\n" +
        "*Resumen:*\n" +
        `• Horas: ${programacion.horas.join(', ')}\n` +
        `• Frecuencia: ${programacion.frecuencia === 'una_vez' ? 'Una sola vez' : 
                       programacion.frecuencia === 'diario' ? 'Diariamente' : 'Personalizado'}\n` +
        `• Fecha inicio: ${moment(programacion.fechaInicio).tz(TIMEZONE).format('DD/MM/YYYY')}\n` +
        (programacion.fechaFin ? `• Fecha fin: ${moment(programacion.fechaFin).tz(TIMEZONE).format('DD/MM/YYYY')}\n` : '') +
        `• Grupos: ${programacion.grupos === 'todos' ? 'Todos' : programacion.grupos.length + ' grupo(s)'}\n` +
        `• Creado: ${moment(programacion.fechaCreacion).tz(TIMEZONE).format('DD/MM/YYYY HH:mm')}\n\n` +
        "¡Gracias por usar el bot! 🚀"
    );
    
    userStates.delete(userId);
    await enviarMenu(message);
}

async function manejarOpcionExistente(message, userId, estadoUsuario) {
    const texto = message.body.trim();
    
    if (texto === '1') {
        estadoUsuario.estado = 'seleccionar_editar';
        userStates.set(userId, estadoUsuario);
        
        let mensajeLista = "📝 *SELECCIONAR MENSAJE A EDITAR*\n\n";
        scheduledMessages.forEach((msg, index) => {
            const mensajeCorto = msg.mensaje ? (msg.mensaje.length > 30 ? msg.mensaje.substring(0, 30) + '...' : msg.mensaje) : '(sin texto)';
            mensajeLista += `${index + 1}. Horas: ${msg.horas.join(', ')} - Mensaje: ${mensajeCorto}\n`;
        });
        
        mensajeLista += "\nEnvía el número del mensaje que quieres editar:";
        await message.reply(mensajeLista);
        
    } else if (texto === '2') {
        await iniciarNuevaProgramacion(message);
        
    } else if (texto === '3') {
        estadoUsuario.estado = 'seleccionar_eliminar';
        userStates.set(userId, estadoUsuario);
        
        let mensajeLista = "🗑️ *SELECCIONAR MENSAJE A ELIMINAR*\n\n";
        scheduledMessages.forEach((msg, index) => {
            mensajeLista += `${index + 1}. Horas: ${msg.horas.join(', ')} - Creado: ${moment(msg.fechaCreacion).tz(TIMEZONE).format('DD/MM/YYYY HH:mm')}\n`;
        });
        
        mensajeLista += "\nEnvía el número del mensaje que quieres eliminar:";
        await message.reply(mensajeLista);
        
    } else if (texto === '4') {
        userStates.delete(userId);
        await message.reply("❌ Operación cancelada. Regresando al menú principal.");
        await enviarMenu(message);
    } else {
        await message.reply("❌ Opción inválida. Por favor envía un número del 1 al 4.");
    }
}

async function manejarSeleccionEditar(message, userId, estadoUsuario) {
    const texto = message.body.trim();
    const indice = parseInt(texto) - 1;
    
    if (isNaN(indice) || indice < 0 || indice >= scheduledMessages.length) {
        await message.reply("❌ Número inválido. Intenta nuevamente.");
        return;
    }
    
    const programacionExistente = scheduledMessages[indice];
    
    await message.reply(
        "🔐 *EDITAR MENSAJE PROGRAMADO*\n\n" +
        "Por favor envía tus credenciales en el formato:\n" +
        "`usuario:contraseña`\n\n" +
        "Ejemplo: admin:admin123\n\n" +
        "O envía *cancelar* para regresar al menú principal."
    );
    
    estadoUsuario.estado = 'esperando_credenciales_editar';
    estadoUsuario.datos.indiceEditar = indice;
    estadoUsuario.datos.programacionExistente = programacionExistente;
    userStates.set(userId, estadoUsuario);
}

async function manejarSeleccionEliminar(message, userId, estadoUsuario) {
    const texto = message.body.trim();
    const indice = parseInt(texto) - 1;
    
    if (isNaN(indice) || indice < 0 || indice >= scheduledMessages.length) {
        await message.reply("❌ Número inválido. Intenta nuevamente.");
        return;
    }
    
    const programacionEliminar = scheduledMessages[indice];
    
    await message.reply(
        "🔐 *ELIMINAR MENSAJE PROGRAMADO*\n\n" +
        "Por favor envía tus credenciales en el formato:\n" +
        "`usuario:contraseña`\n\n" +
        "Ejemplo: admin:admin123\n\n" +
        "O envía *cancelar* para regresar al menú principal."
    );
    
    estadoUsuario.estado = 'esperando_credenciales_eliminar';
    estadoUsuario.datos.indiceEliminar = indice;
    estadoUsuario.datos.programacionEliminar = programacionEliminar;
    userStates.set(userId, estadoUsuario);
}

async function eliminarProgramacion(message, userId, estadoUsuario) {
    const indice = estadoUsuario.datos.indiceEliminar;
    const programacionEliminada = scheduledMessages.splice(indice, 1)[0];
    
    if (programacionEliminada.archivoInfo && fs.existsSync(programacionEliminada.archivoInfo.ruta)) {
        try {
            fs.unlinkSync(programacionEliminada.archivoInfo.ruta);
        } catch (error) {
        }
    }
    
    try {
        const archivoProgramaciones = path.join(__dirname, 'programaciones.json');
        fs.writeFileSync(archivoProgramaciones, JSON.stringify(scheduledMessages, null, 2));
    } catch (error) {
    }
    
    await message.reply(
        "✅ *PROGRAMACIÓN ELIMINADA EXITOSAMENTE*\n\n" +
        "*Mensaje eliminado:*\n" +
        `• Horas: ${programacionEliminada.horas.join(', ')}\n` +
        `• Fecha creación: ${moment(programacionEliminada.fechaCreacion).tz(TIMEZONE).format('DD/MM/YYYY HH:mm')}\n\n` +
        "¡Gracias por usar el bot! 🚀"
    );
    
    userStates.delete(userId);
    await enviarMenu(message);
}

async function manejarSkapILC(message, userId) {
    userStates.set(userId, { 
        estado: 'esperando_codigo_skap_ilc',
        datos: {}
    });
    
    await message.reply(
        "📋 *CONSULTA SKAP - ILC*\n\n" +
        "Para poder revisar tus notas de SKAP, envía tu código de empleado a continuación:\n\n" +
        "*Ejemplos de códigos ILC:*\n" +
        "• 76001111 (código completo)\n" +
        "• 1111 (parte del código)\n" +
        "• 7601260\n" +
        "• 1260\n" +
        "• 76011111\n" +
        "• 11111\n\n" +
        "*📝 IMPORTANTE:*\n" +
        "Puedes buscar con el código completo o cualquier parte que coincida.\n" +
        "El sistema busca en todos los campos posibles.\n\n" +
        "O envía *cancelar* para regresar al menú."
    );
}

async function manejarSkapOUTS(message, userId) {
    userStates.set(userId, { 
        estado: 'esperando_codigo_skap_outs',
        datos: {}
    });
    
    await message.reply(
        "📋 *CONSULTA SKAP - OUTS*\n\n" +
        "Para poder revisar tu licencia para operar, envía tu código de empleado a continuación:\n\n" +
        "*Ejemplos de códigos OUTS:*\n" +
        "• 11111111 (código completo)\n" +
        "• 1111 (parte del código)\n" +
        "• 1111\n" +
        "• 11111\n" +
        "• 1111\n\n" +
        "*📝 IMPORTANTE:*\n" +
        "Puedes buscar con el código completo o cualquier parte que coincida.\n" +
        "El sistema busca en todos los campos posibles.\n\n" +
        "O envía *cancelar* para regresar al menú."
    );
}

async function enviarBienvenidaGrupo(chat) {
    try {
        const mensajeBienvenida = 
            `👋 *¡Hola a todos!*\n\n` +
            `Mi nombre es *Jarabito* 🤖, tu asistente de seguridad e información de *Jarabe*\n\n` +
            `*¿Cómo puedo ayudarte?*\n\n` +
            `Para interactuar conmigo, simplemente escribe el comando:\n` +
            `*/menu* o */menú*\n\n` +
            `*✨ Funciones disponibles:*\n` +
            `• Consultar semáforo de territorios 🚦\n` +
            `• Consultar información SKAP 📋\n` +
            `• Acceder a checklists de seguridad ✅\n` +
            `• Y mucho más...\n\n` +
            `*⚠️ IMPORTANTE:*\n` +
            `Solo responderé cuando uses el comando */menu* o */menú* primero.\n\n` +
            `¡Estoy aquí para ayudar! 🚀`;
        
        await chat.sendMessage(mensajeBienvenida);
        console.log(`✅ Mensaje de bienvenida enviado al grupo: ${chat.name}`);
    } catch (error) {
        console.error("❌ Error al enviar mensaje de bienvenida:", error);
    }
}

async function manejarEstadoUsuario(message, userId) {
    const estadoUsuario = userStates.get(userId);
    const texto = message.body.trim().toLowerCase();
    
    if (texto === 'cancelar') {
        userStates.delete(userId);
        await message.reply("❌ Operación cancelada. Regresando al menú principal.");
        await enviarMenu(message);
        return;
    }
    
    if (estadoUsuario.estado === 'checklist_menu_principal') {
        if (texto === '1') {
            await obtenerGruposDisponibles(message, userId);
        } else if (texto === '2') {
            await obtenerInfoTecnico(message, userId);
        } else {
            await message.reply("❌ Opción inválida. Por favor envía 1 para Grupos o 2 para Técnicos.");
        }
        return;
    }
    
    if (estadoUsuario.estado === 'checklist_esperando_grupo') {
        const opcion = parseInt(texto);
        const grupos = estadoUsuario.datos.grupos;
        
        if (isNaN(opcion) || opcion < 1 || opcion > grupos.length) {
            await message.reply(`❌ Opción inválida. Por favor envía un número del 1 al ${grupos.length}.`);
            return;
        }
        
        const grupoSeleccionado = grupos[opcion - 1];
        await obtenerAnosDisponibles(message, userId, 'grupo', grupoSeleccionado);
        return;
    }
    
    if (estadoUsuario.estado === 'checklist_esperando_ano_grupo') {
        const opcion = parseInt(texto);
        const anos = estadoUsuario.datos.anos;
        
        if (isNaN(opcion) || opcion < 1 || opcion > anos.length) {
            await message.reply(`❌ Opción inválida. Por favor envía un número del 1 al ${anos.length}.`);
            return;
        }
        
        const añoSeleccionado = anos[opcion - 1];
        await obtenerMesesGrupo(message, userId, estadoUsuario.datos.grupo, añoSeleccionado);
        return;
    }
    
    if (estadoUsuario.estado === 'checklist_esperando_mes_grupo') {
        const mes = parseInt(texto);
        
        if (isNaN(mes) || mes < 1 || mes > 12) {
            await message.reply("❌ Opción inválida. Por favor envía un número del 1 al 12.");
            return;
        }
        
        await obtenerResultadosGrupo(message, userId, estadoUsuario.datos.grupo, estadoUsuario.datos.año, mes);
        return;
    }
    
    if (estadoUsuario.estado === 'checklist_consultar_otro_periodo_grupo') {
        if (texto === '1') {
            await obtenerAnosDisponibles(message, userId, 'grupo', estadoUsuario.datos.grupo);
        } else if (texto === '2') {
            userStates.delete(userId);
            await enviarMenu(message);
        } else {
            await message.reply("❌ Opción inválida. Por favor envía 1 para otro período o 2 para volver al menú.");
        }
        return;
    }
    
    if (estadoUsuario.estado === 'checklist_esperando_codigo_tecnico') {
        const codigo = message.body.trim();
        
        if (!codigo || codigo === '') {
            await message.reply("❌ Por favor ingresa un código válido.");
            return;
        }
        
        await obtenerAnosDisponibles(message, userId, 'tecnico', codigo);
        return;
    }
    
    if (estadoUsuario.estado === 'checklist_esperando_ano_tecnico') {
        const opcion = parseInt(texto);
        const anos = estadoUsuario.datos.anos;
        
        if (isNaN(opcion) || opcion < 1 || opcion > anos.length) {
            await message.reply(`❌ Opción inválida. Por favor envía un número del 1 al ${anos.length}.`);
            return;
        }
        
        const añoSeleccionado = anos[opcion - 1];
        await obtenerMesesTecnico(message, userId, estadoUsuario.datos.tecnico, añoSeleccionado);
        return;
    }
    
    if (estadoUsuario.estado === 'checklist_esperando_mes_tecnico') {
        const mes = parseInt(texto);
        
        if (isNaN(mes) || mes < 1 || mes > 12) {
            await message.reply("❌ Opción inválida. Por favor envía un número del 1 al 12.");
            return;
        }
        
        await obtenerResultadosTecnico(message, userId, estadoUsuario.datos, estadoUsuario.datos.año, mes);
        return;
    }
    
    if (estadoUsuario.estado === 'checklist_consultar_otro_periodo_tecnico') {
        if (texto === '1') {
            await obtenerAnosDisponibles(message, userId, 'tecnico', estadoUsuario.datos.codigo);
        } else if (texto === '2') {
            userStates.delete(userId);
            await enviarMenu(message);
        } else {
            await message.reply("❌ Opción inválida. Por favor envía 1 para otro período o 2 para volver al menú.");
        }
        return;
    }
    
    if (estadoUsuario.estado === 'esperando_codigo_skap_ilc') {
        const codigoEmpleado = message.body.trim();
        
        if (!codigoEmpleado || codigoEmpleado === '') {
            await message.reply("❌ Por favor ingresa un código válido.");
            return;
        }
        
        await message.reply("🔍 Buscando información de SKAP ILC...");
        
        try {
            const resultado = await buscarSkapILC(codigoEmpleado);
            await message.reply(resultado);
            
        } catch (error) {
            console.error("Error en búsqueda ILC:", error.message);
            
            await message.reply("🔄 Intentando búsqueda alternativa en la página web...");
            try {
                const resultadoAlt = await buscarEnPaginaDirecta(codigoEmpleado, 'ILC');
                await message.reply(resultadoAlt);
            } catch (error2) {
                await message.reply("❌ Error en la búsqueda. Intenta nuevamente.");
            }
        }
        
        userStates.delete(userId);
        await enviarMenu(message);
        return;
    }
    
    if (estadoUsuario.estado === 'esperando_codigo_skap_outs') {
        const codigoEmpleado = message.body.trim();
        
        if (!codigoEmpleado || codigoEmpleado === '') {
            await message.reply("❌ Por favor ingresa un código válido.");
            return;
        }
        
        await message.reply("🔍 Buscando información de SKAP OUTS...");
        
        try {
            const resultado = await buscarSkapOUTS(codigoEmpleado);
            await message.reply(resultado);
            
        } catch (error) {
            console.error("Error en búsqueda OUTS:", error.message);
            
            await message.reply("🔄 Intentando búsqueda alternativa en la página web...");
            try {
                const resultadoAlt = await buscarEnPaginaDirecta(codigoEmpleado, 'OUTS');
                await message.reply(resultadoAlt);
            } catch (error2) {
                await message.reply("❌ Error en la búsqueda. Intenta nuevamente.");
            }
        }
        
        userStates.delete(userId);
        await enviarMenu(message);
        return;
    }
    
    if (estadoUsuario.estado === 'seleccionar_tipo_skap') {
        if (texto === '1') {
            await manejarSkapILC(message, userId);
        } else if (texto === '2') {
            await manejarSkapOUTS(message, userId);
        } else {
            await message.reply("❌ Opción inválida. Por favor envía 1 para ILC o 2 para OUTS.");
        }
        return;
    }
    
    if (estadoUsuario.estado === 'seleccionar_opcion_existente') {
        await manejarOpcionExistente(message, userId, estadoUsuario);
        return;
    }
    
    if (estadoUsuario.estado === 'seleccionar_editar') {
        await manejarSeleccionEditar(message, userId, estadoUsuario);
        return;
    }
    
    if (estadoUsuario.estado === 'seleccionar_eliminar') {
        await manejarSeleccionEliminar(message, userId, estadoUsuario);
        return;
    }
    
    if (estadoUsuario.estado === 'esperando_credenciales_editar' || estadoUsuario.estado === 'esperando_credenciales_eliminar') {
        if (texto.includes(':')) {
            const partes = texto.split(':');
            const usuario = partes[0].trim();
            const contrasena = partes[1].trim();
            
            if (usuario === ADMIN_CREDENTIALS.username && contrasena === ADMIN_CREDENTIALS.password) {
                if (estadoUsuario.estado === 'esperando_credenciales_editar') {
                    estadoUsuario.estado = 'seleccionar_tipo_contenido_editar';
                    estadoUsuario.datos = {
                        ...estadoUsuario.datos.programacionExistente,
                        indiceEditar: estadoUsuario.datos.indiceEditar
                    };
                    userStates.set(userId, estadoUsuario);
                    
                    await message.reply(
                        "✅ *Credenciales correctas*\n\n" +
                        "¿Qué tipo de contenido deseas programar?\n\n" +
                        "1️⃣ - Mantener archivo actual\n" +
                        "2️⃣ - Cambiar imagen\n" +
                        "3️⃣ - Cambiar video\n" +
                        "4️⃣ - Cambiar documento\n" +
                        "5️⃣ - Solo texto (sin archivo adjunto)\n\n" +
                        "Envía el número de la opción (1-5)"
                    );
                } else {
                    await eliminarProgramacion(message, userId, estadoUsuario);
                }
            } else {
                await message.reply("❌ Credenciales incorrectas. Intenta nuevamente.");
            }
        } else {
            await message.reply("Formato incorrecto. Usa: usuario:contraseña");
        }
        return;
    }
    
    if (estadoUsuario.estado === 'seleccionar_tipo_contenido_editar') {
        const opcion = texto;
        
        if (opcion === '1') {
            estadoUsuario.estado = 'esperando_mensaje_editar';
            userStates.set(userId, estadoUsuario);
            
            await message.reply(
                "✅ *Archivo conservado*\n\n" +
                "Ahora envía el NUEVO mensaje de texto:\n\n" +
                "O envía *omitir* si solo quieres enviar el archivo sin texto.\n" +
                "O envía *mantener* para conservar el mensaje actual."
            );
            
        } else if (opcion === '2') {
            estadoUsuario.datos.tipoContenido = 'imagen';
            estadoUsuario.estado = 'esperando_archivo_editar';
            userStates.set(userId, estadoUsuario);
            
            await message.reply(
                "📸 *CAMBIAR IMAGEN*\n\n" +
                "Envía la NUEVA imagen:\n\n" +
                "O envía *mantener* para conservar la imagen actual."
            );
            
        } else if (opcion === '3') {
            estadoUsuario.datos.tipoContenido = 'video';
            estadoUsuario.estado = 'esperando_archivo_editar';
            userStates.set(userId, estadoUsuario);
            
            await message.reply(
                "🎬 *CAMBIAR VIDEO*\n\n" +
                "Envía el NUEVO video:\n\n" +
                "O envía *mantener* para conservar el video actual."
            );
            
        } else if (opcion === '4') {
            estadoUsuario.datos.tipoContenido = 'documento';
            estadoUsuario.estado = 'esperando_archivo_editar';
            userStates.set(userId, estadoUsuario);
            
            await message.reply(
                "📄 *CAMBIAR DOCUMENTO*\n\n" +
                "Envía el NUEVO documento:\n\n" +
                "O envía *mantener* para conservar el documento actual."
            );
            
        } else if (opcion === '5') {
            estadoUsuario.datos.tipoContenido = 'texto';
            estadoUsuario.datos.archivoInfo = null;
            estadoUsuario.estado = 'esperando_mensaje_editar';
            userStates.set(userId, estadoUsuario);
            
            await message.reply(
                "📝 *SOLO TEXTO*\n\n" +
                "Ahora envía el NUEVO mensaje de texto:\n\n" +
                "O envía *mantener* para conservar el mensaje actual."
            );
            
        } else {
            await message.reply("❌ Opción inválida. Por favor envía un número del 1 al 5.");
        }
        return;
    }
    
    if (estadoUsuario.estado === 'esperando_credenciales') {
        await manejarCredenciales(message, userId, estadoUsuario);
        return;
    }
    
    if (estadoUsuario.estado === 'seleccionar_tipo_contenido') {
        await manejarTipoContenido(message, userId, estadoUsuario);
        return;
    }
    
    if (estadoUsuario.estado === 'esperando_archivo') {
        await manejarArchivo(message, userId, estadoUsuario);
        return;
    }
    
    if (estadoUsuario.estado === 'esperando_mensaje') {
        await manejarMensajeTexto(message, userId, estadoUsuario);
        return;
    }
    
    if (estadoUsuario.estado === 'seleccionar_cantidad_horas') {
        await manejarCantidadHoras(message, userId, estadoUsuario);
        return;
    }
    
    if (estadoUsuario.estado === 'esperando_hora_unica') {
        await manejarHoraUnica(message, userId, estadoUsuario);
        return;
    }
    
    if (estadoUsuario.estado === 'esperando_horas') {
        await manejarHorasDos(message, userId, estadoUsuario);
        return;
    }
    
    if (estadoUsuario.estado === 'esperando_tres_horas') {
        await manejarTresHoras(message, userId, estadoUsuario);
        return;
    }
    
    if (estadoUsuario.estado === 'seleccionar_frecuencia') {
        await manejarFrecuencia(message, userId, estadoUsuario);
        return;
    }
    
    if (estadoUsuario.estado === 'esperando_fecha_inicio') {
        await manejarFechaInicio(message, userId, estadoUsuario);
        return;
    }
    
    if (estadoUsuario.estado === 'esperando_fecha_fin') {
        await manejarFechaFin(message, userId, estadoUsuario);
        return;
    }
    
    if (estadoUsuario.estado === 'esperando_confirmacion_grupos') {
        await manejarConfirmacionGrupos(message, userId, estadoUsuario);
        return;
    }
    
    if (estadoUsuario.estado === 'seleccionando_grupos') {
        await manejarSeleccionGrupos(message, userId, estadoUsuario);
        return;
    }
    
    if (estadoUsuario.estado === 'mostrando_vista_previa') {
        if (texto === '1' || texto === 'sí' || texto === 'si') {
            await guardarProgramacion(message, userId, estadoUsuario);
        } else if (texto === '2' || texto === 'no') {
            userStates.delete(userId);
            await message.reply("❌ Programación cancelada. Volviendo al menú principal.");
            await enviarMenu(message);
        } else {
            await message.reply("Por favor selecciona:\n1 - Sí, guardar\n2 - No, cancelar");
        }
        return;
    }
    
    userStates.delete(userId);
    await enviarMenu(message);
}

async function enviarMenu(message) {
    const saludo = obtenerSaludo();
    
    const menu = 
        `*Hola ${saludo}!* 🌞\n` +
        `Mi nombre es *Jarabito* 🤖, tu asistente de seguridad e información de Jarabe.\n` +
        `¿En qué te puedo ayudar hoy?\n\n` +
        `*Selecciona una opción:*\n\n` +
        `1️⃣ - *Acadia* 📊\n` +
        `2️⃣ - *Guardian* 🛡️\n` +
        `3️⃣ - *Checklist de seguridad* ✅\n` +
        `4️⃣ - *Semáforo de territorio* 🚦\n` +
        `5️⃣ - *Agua* 💧\n` +
        `6️⃣ - *Energía* ⚡\n` +
        `7️⃣ - *CIP Jarabe terminado*\n` +
        `8️⃣ - *CIP Jarabe simple*\n` +
        `9️⃣ - *Programar mensajes* ⏰\n` +
        `🔟 - *SKAP* 📋\n\n` +
        `*Envía el número de la opción (1-10)*`;
    
    await message.reply(menu);
}

async function manejarOpcionMenu(message, opcion) {
    const links = {
        1: "https://ab-inbev.acadia.sysalli.com/documents?filter=lang-eql:es-mx&page=1&pagesize=50",
        2: "https://guardian.ab-inbev.com/home",
        3: "checklist",
        4: "semáforo",
        5: "https://jarabeterminado.web.app/",
        6: "https://energia2-7e868.web.app/",
        7: "https://cijarabe2.web.app/",
        8: "https://cip-jarabesimple.web.app/"
    };
    
    if (opcion >= 1 && opcion <= 2) {
        await message.reply(`🔗 *Enlace para la opción ${opcion}:*\n${links[opcion]}\n\n*Nota:* Haz click en el enlace para poder entrar.`);
    } else if (opcion === 3) {
        await obtenerChecklistSeguridad(message, message.from);
    } else if (opcion === 4) {
        await message.reply("⏳ Consultando semáforo de territorio...");
        const resultado = await obtenerSemaforoTerritorio();
        await message.reply(resultado);
    } else if (opcion >= 5 && opcion <= 8) {
        await message.reply(`🔗 *Enlace para la opción ${opcion}:*\n${links[opcion]}\n\n*Nota:* Haz click en el enlace para poder entrar.`);
    } else if (opcion === 9) {
        await iniciarProgramacion(message);
    } else if (opcion === 10) {
        const userId = message.from;
        userStates.set(userId, { estado: 'seleccionar_tipo_skap', datos: {} });
        
        await message.reply(
            "📋 *SISTEMA SKAP*\n\n" +
            "Elige el tipo de consulta:\n\n" +
            "1️⃣ - *ILC*\n" +
            "2️⃣ - *OUTS*\n\n" +
            "Envía el número de la opción (1-2)\n" +
            "O envía *cancelar* para regresar al menú principal."
        );
    }
}

async function verificarMensajesProgramados() {
    const horaActual = moment().tz(TIMEZONE).format('HH:mm');
    const fechaActual = moment().tz(TIMEZONE).format('YYYY-MM-DD');
    
    for (let i = 0; i < scheduledMessages.length; i++) {
        const programacion = scheduledMessages[i];
        
        const fechaActualObj = moment().tz(TIMEZONE).startOf('day');
        const fechaInicio = moment(programacion.fechaInicio).tz(TIMEZONE).startOf('day');
        const fechaFin = programacion.fechaFin ? moment(programacion.fechaFin).tz(TIMEZONE).startOf('day') : null;
        
        if (programacion.frecuencia === 'una_vez' && fechaActualObj > fechaInicio) {
            continue;
        }
        
        if (fechaActualObj < fechaInicio) {
            continue;
        }
        
        if (fechaFin && fechaActualObj > fechaFin) {
            continue;
        }
        
        const horaYaEnviadaHoy = programacion.enviosHoy && 
                                  programacion.enviosHoy.includes(`${fechaActual}-${horaActual}`);
        
        if (horaYaEnviadaHoy) {
            continue;
        }
        
        for (const horaProgramada of programacion.horas) {
            if (horaProgramada === horaActual) {
                await enviarMensajeProgramado(programacion);
                console.log(`📤 Mensaje enviado a las ${horaActual}`);
                
                if (!programacion.enviosHoy) {
                    scheduledMessages[i].enviosHoy = [];
                }
                scheduledMessages[i].enviosHoy.push(`${fechaActual}-${horaActual}`);
                
                if (scheduledMessages[i].ultimoEnvio) {
                    const ultimoEnvioFecha = moment(scheduledMessages[i].ultimoEnvio).tz(TIMEZONE).format('YYYY-MM-DD');
                    if (ultimoEnvioFecha !== fechaActual) {
                        scheduledMessages[i].enviosHoy = [`${fechaActual}-${horaActual}`];
                    }
                }
                
                scheduledMessages[i].ultimoEnvio = new Date();
                
                try {
                    const archivoProgramaciones = path.join(__dirname, 'programaciones.json');
                    fs.writeFileSync(archivoProgramaciones, JSON.stringify(scheduledMessages, null, 2));
                } catch (error) {
                }
                
                break;
            }
        }
    }
    
    const ahora = moment().tz(TIMEZONE);
    const hoy = ahora.format('YYYY-MM-DD');
    
    for (let i = 0; i < scheduledMessages.length; i++) {
        if (scheduledMessages[i].enviosHoy && scheduledMessages[i].enviosHoy.length > 0) {
            const enviosHoy = scheduledMessages[i].enviosHoy.filter(enviado => enviado.startsWith(hoy));
            scheduledMessages[i].enviosHoy = enviosHoy;
        }
    }
}

async function enviarMensajeProgramado(programacion) {
    try {
        let chats = [];
        
        if (programacion.grupos === 'todos') {
            const todosChats = await client.getChats();
            chats = todosChats.filter(chat => chat.isGroup);
        } else {
            for (const grupoId of programacion.grupos) {
                try {
                    const chat = await client.getChatById(grupoId);
                    if (chat) chats.push(chat);
                } catch (error) {
                }
            }
        }
        
        let media = null;
        if (programacion.archivoInfo && fs.existsSync(programacion.archivoInfo.ruta)) {
            media = MessageMedia.fromFilePath(programacion.archivoInfo.ruta);
        } else if (programacion.imagenPath && fs.existsSync(programacion.imagenPath)) {
            media = MessageMedia.fromFilePath(programacion.imagenPath);
        }
        
        for (const chat of chats) {
            try {
                if (media) {
                    if (programacion.mensaje && programacion.mensaje !== "") {
                        await chat.sendMessage(media, { caption: programacion.mensaje });
                    } else {
                        await chat.sendMessage(media);
                    }
                } else if (programacion.mensaje && programacion.mensaje !== "") {
                    await chat.sendMessage(programacion.mensaje);
                }
                
                console.log(`✅ Enviado a: ${chat.name}`);
                
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
            }
        }
        
    } catch (error) {
    }
}

client.on('qr', async qr => {
    console.clear();
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║                    ESCANEA EL QR                         ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log('║ 📱 Instrucciones:                                        ║');
    console.log('║    1. Abre WhatsApp en tu teléfono                       ║');
    console.log('║    2. Menú → WhatsApp Web                                ║');
    console.log('║    3. Escanea el código QR                               ║');
    console.log('║    4. ESPERA 10-20 segundos                              ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');
    
    try {
        const qrImage = await qrcode.toString(qr, { type: 'terminal', small: true });
        console.log(qrImage);
    } catch (err) {
        console.log('Error generando QR:', err);
        qrcode.generate(qr, { small: true });
    }
    
    console.log(`\n📅 ${moment().tz(TIMEZONE).format('DD/MM/YYYY HH:mm:ss')}`);
    console.log('📍 América/El_Salvador');
    console.log('\n⚠️ Si no funciona después de 30 segundos, reinicia el bot.');
});

client.on('authenticated', () => {
    console.log('✅ Autenticación exitosa!');
});

client.on('auth_failure', msg => {
    console.error('❌ Error de autenticación:', msg);
});

client.on('ready', async () => {
    console.clear();
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║                 ✅ BOT CONECTADO EXITOSAMENTE            ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log(`║ 🤖 Nombre: ${client.info.pushname || 'Jarabito'}                       ║`);
    console.log(`║ 📞 Número: ${client.info.wid.user}                            ║`);
    console.log(`║ ⏰ Hora: ${moment().tz(TIMEZONE).format('DD/MM/YYYY HH:mm:ss')}  ║`);
    console.log('║ 📍 Zona: América/El_Salvador                              ║');
    console.log('║ 🚀 Estado: LISTO PARA RECIBIR MENSAJES                    ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');
});

client.on('loading_screen', (percent, message) => {
    console.log(`🔄 Cargando: ${percent}% - ${message}`);
});

function cargarProgramacionesGuardadas() {
    try {
        const archivoProgramaciones = path.join(__dirname, 'programaciones.json');
        if (fs.existsSync(archivoProgramaciones)) {
            const contenido = fs.readFileSync(archivoProgramaciones, 'utf8');
            const programaciones = JSON.parse(contenido);
            
            scheduledMessages.length = 0;
            scheduledMessages.push(...programaciones);
            console.log(`📂 Cargadas ${programaciones.length} programaciones guardadas`);
        }
    } catch (error) {
        console.error("Error al cargar programaciones guardadas:", error);
    }
}

client.on('group_join', async (notification) => {
    console.log(`🤖 *Jarabito* fue agregado al grupo: ${notification.chatId}`);
    
    try {
        const chat = await client.getChatById(notification.chatId);
        if (chat.isGroup) {
            await enviarBienvenidaGrupo(chat);
        }
    } catch (error) {
        console.error("❌ Error al manejar ingreso a grupo:", error);
    }
});

client.on('message', async message => {
    try {
        const texto = message.body.trim();
        const userId = message.from;
        
        console.log(`📩 [${moment().tz(TIMEZONE).format('HH:mm:ss')}] Mensaje de ${userId}: ${texto.substring(0, 50)}...`);
        
        if (userStates.has(userId)) {
            await manejarEstadoUsuario(message, userId);
            return;
        }
        
        if (texto.toLowerCase() === '/menu' || texto.toLowerCase() === '/menú') {
            await enviarMenu(message);
            return;
        }
        
        if (/^[1-9]$|^10$/.test(texto)) {
            await manejarOpcionMenu(message, parseInt(texto));
            return;
        }
        
        if (texto.toLowerCase() === 'ayuda' || texto.toLowerCase() === 'help') {
            await message.reply(
                "🤖 *BOT JARABITO - ASISTENTE DE SEGURIDAD Y INFORMACIÓN.*\n\n" +
                "Comandos disponibles:\n" +
                "• /menu o /menú - Mostrar menú principal\n" +
                "• 1-10 - Seleccionar opción del menú\n" +
                "• ayuda - Mostrar esta ayuda\n\n" +
                "*IMPORTANTE:*\n" +
                "Debes usar el comando /menu primero para interactuar conmigo.\n\n" +
                "¡Estoy aquí para ayudarte! 🚀"
            );
            return;
        }
        
        if (message.from.endsWith('@g.us')) {
            if (!texto.startsWith('/') && !/^[1-9]$|^10$/.test(texto) && texto.toLowerCase() !== 'ayuda') {
                return;
            }
        }
        
    } catch (error) {
        console.error("❌ Error en manejo de mensaje:", error);
    }
});

client.on('auth_failure', msg => {
    console.error('❌ Error de autenticación:', msg);
    console.log('🔄 Reiniciando en 10 segundos...');
    setTimeout(() => client.initialize(), 10000);
});

client.on('disconnected', reason => {
    console.log('❌ Desconectado:', reason);
    console.log('🔄 Reconectando en 5 segundos...');
    setTimeout(() => client.initialize(), 5000);
});

async function iniciarBot() {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║                INICIANDO BOT DE WHATSAPP                ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log(`║ 🖥️  Sistema: ${process.platform}                                ║`);
    console.log(`║ 📦 Node.js: ${process.version}                             ║`);
    console.log(`║ ⏰ Hora: ${new Date().toLocaleString()}                    ║`);
    console.log('╚══════════════════════════════════════════════════════════╝\n');
    
    crearCarpetas();
    cargarProgramacionesGuardadas();
    setInterval(verificarMensajesProgramados, 60000);
    
    await client.initialize();
    
    setInterval(() => {
        if (client.info) {
            const ahora = moment().tz(TIMEZONE);
            console.log(`[${ahora.format('HH:mm:ss')}] 🤖 Bot activo | Programaciones: ${scheduledMessages.length} | Usuarios: ${userStates.size}`);
        }
    }, 300000);
}

process.on('SIGINT', async () => {
    console.log('\n\n👋 Cerrando bot de WhatsApp...');
    
    try {
        const archivoProgramaciones = path.join(__dirname, 'programaciones.json');
        fs.writeFileSync(archivoProgramaciones, JSON.stringify(scheduledMessages, null, 2));
        console.log('💾 Programaciones guardadas');
    } catch (error) {
        console.error('❌ Error al guardar programaciones:', error);
    }
    
    await client.destroy();
    console.log('✅ Bot cerrado correctamente');
    process.exit(0);
});

iniciarBot().catch(error => {
    console.error('❌ ERROR CRÍTICO AL INICIAR:', error);
    console.log('\n💡 POSIBLES SOLUCIONES:');
    console.log('1. Verifica tu conexión a internet');
    console.log('2. Cierra todas las ventanas de Chrome/Chromium');
    console.log('3. Reinstala dependencias: npm install');
    console.log('4. Ejecuta como administrador');
    console.log('5. Actualiza Node.js a versión 18 o superior');
});
