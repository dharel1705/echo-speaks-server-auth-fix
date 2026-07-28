const express = require('express');
const alexaCookie = require('alexa-cookie2');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const axios = require('axios');

const PORT = process.env.PORT || 8580;
const configFilePath = path.join(__dirname, 'config.json');
const sessionFilePath = path.join(__dirname, 'session.json');

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => `[${timestamp}] [${level.toUpperCase()}]: ${message}`)
    ),
    transports: [new winston.transports.Console()]
});

const webApp = express();
const urlencodedParser = bodyParser.urlencoded({ extended: false });

// Apply body parsing configurations across all incoming network requests
webApp.use(bodyParser.json());
webApp.use(bodyParser.urlencoded({ extended: true }));

let configData = { settings: {} };
let runTimeData = { savedConfig: { cookieData: null } };

function loadConfig() {
    if (fs.existsSync(configFilePath)) {
        try { configData = JSON.parse(fs.readFileSync(configFilePath, 'utf8')); } 
        catch (e) { logger.error('Failed to parse config file'); }
    }
}

function loadSession() {
    if (fs.existsSync(sessionFilePath)) {
        try { runTimeData = JSON.parse(fs.readFileSync(sessionFilePath, 'utf8')); } 
        catch (e) { logger.error('Failed to parse session file'); }
    }
}

function updSessionItem(key, val) {
    if (!runTimeData.savedConfig) runTimeData.savedConfig = {};
    runTimeData.savedConfig[key] = val;
    fs.writeFileSync(sessionFilePath, JSON.stringify(runTimeData, null, 2), 'utf8');
}

function sendCookiesToEndpoint(url, data) {
    if (!url) return;
    axios.post(url, data).catch(err => logger.error(`Error sending cookies: ${err.message}`));
}

loadConfig();
loadSession();

// ROOT LANDING REDIRECT
webApp.get('/', (req, res) => {
    res.send('<h1>Echo Speaks Background Proxy Active</h1><p>Automatic refreshing is managed via Hubitat.</p><p><a href="/config">Go to Configuration Panel</a></p>');
});

// HUBITAT APP PORTAL ROUTE
webApp.get('/config', (req, res) => {
    const callbackUrl = configData.settings.appCallbackUrl || '';
    res.send(`
        <html>
        <head><title>Echo Speaks Settings</title><style>body{font-family:sans-serif;max-width:500px;margin:auto;padding:30px;} input{width:100%;padding:10px;margin:10px 0;} .btn{background:#FF9900;color:white;border:none;padding:12px;width:100%;cursor:pointer;font-weight:bold;text-decoration:none;display:block;text-align:center;}</style></head>
        <body>
            <h2>Echo Speaks Local Configuration</h2>
            <form action="/saveConfig" method="POST">
                <label>App Callback URL (From Hubitat):</label>
                <input type="text" name="appCallbackUrl" value="${callbackUrl}" placeholder="Paste URL here..." required />
                <button type="submit" class="btn" style="background:#00a8e1;">Save Callback URL</button>
            </form>
            <hr/>
            <a href="/refreshCookie" class="btn">Trigger Amazon Cookie Login / Refresh</a>
        </body>
        </html>
    `);
});

// FORM PARSING DATA ROUTE
webApp.post('/saveConfig', urlencodedParser, (req, res) => {
    if (req.body && req.body.appCallbackUrl) {
        configData.settings.appCallbackUrl = req.body.appCallbackUrl;
        fs.writeFileSync(configFilePath, JSON.stringify(configData, null, 2), 'utf8');
        logger.info(`Saved App Callback URL: ${req.body.appCallbackUrl}`);
        res.redirect('/config');
    } else {
        res.status(400).send('<h1>Error saving configuration</h1><p>Callback URL parameter was missing.</p>');
    }
});

// DUAL COMPATIBILITY LOGIN / REFRESH INTERCEPTOR ENGINE
webApp.get('/refreshCookie', urlencodedParser, (req, res) => {
    logger.info('Authentication sequence initiated...');

    const loginOptions = {
        setupProxy: true,
        proxyPort: PORT,
        proxyOwnIp: '192.168.1.48',
        formerRegistrationData: runTimeData.savedConfig?.cookieData,
        puppeteerOptions: {
            executablePath: '/usr/bin/chromium-browser',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        }
    };

    // If baseline tokens don't exist yet, launch explicit proxy stream interception
    if (!runTimeData?.savedConfig?.cookieData) {
        logger.info('No cached baseline profile found. Booting manual proxy login listener...');
        alexaCookie.expressLogin(webApp, loginOptions, (err, result) => {
            if (result && Object.keys(result).length >= 2) {
                sendCookiesToEndpoint(configData.settings.appCallbackUrl, result);
                runTimeData.savedConfig.cookieData = result;
                updSessionItem('cookieData', result);
                logger.info('SUCCESS: Manual login tokens trapped and written to local database cache!');
                res.send('<h1>Authentication Good!</h1><p>Your local proxy has successfully stored your tokens and sent them to Hubitat.</p>');
            } else {
                logger.error(`Manual login proxy failed: ${err || 'Process timed out'}`);
                res.status(500).send('<h1>Login Failed</h1><p>Check Unraid system log panel for diagnostic details.</p>');
            }
        });
    } else {
        // If baseline tokens exist, run completely hands-free background emulation loop
        logger.info('Baseline profile exists. Executing automated background browser driver refresh...');
        alexaCookie.refreshAlexaCookie(loginOptions, (err, result) => {
            if (result && Object.keys(result).length >= 2) {
                sendCookiesToEndpoint(configData.settings.appCallbackUrl, result);
                runTimeData.savedConfig.cookieData = result;
                updSessionItem('cookieData', result);
                logger.info('SUCCESS: Background cookies silently updated and saved!');
                res.send('<h1>Authentication Good!</h1><p>Automated background refresh successful.</p>');
            } else {
                logger.error(`Automated refresh failed: ${err || 'Amazon rejected authentication refresh token'}`);
                
                // Integrated x86cpu fallback backup cache validation loop
                if (runTimeData?.savedConfig?.cookieData) {
                    logger.warn('Engaging x86cpu fallback: Providing previously cached session state.');
                    res.send('<h1>Authentication Kept Alive via Fallback Cache!</h1>');
                    return;
                }
                res.status(500).send('<h1>Refresh Failed</h1><p>Could not contact Amazon. Check Unraid logs for details.</p>');
            }
        });
    }
});

webApp.get('/configData', (req, res) => { res.send(configData); });

webApp.listen(PORT, () => {
    logger.info(`Echo Speaks Automated Server active on port ${PORT}`);
});
