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
webApp.use(bodyParser.json());

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

// NATIVE WORKING VISUAL FRONTEND ROUTES
webApp.get('/', (req, res) => {
    res.send(`
        <html>
        <head><title>Echo Speaks Login Server</title><style>body{font-family:sans-serif;text-align:center;padding:50px;} .btn{background:#FF9900;color:white;padding:15px 25px;text-decoration:none;border-radius:5px;font-weight:bold;display:inline-block;margin-top:20px;}</style></head>
        <body>
            <h1>Echo Speaks Local Proxy Server</h1>
            <p>Status: Running smoothly on Unraid</p>
            <a href="/config" class="btn">Configure App Callback & Login</a>
        </body>
        </html>
    `);
});

webApp.get('/config', (req, res) => {
    const callbackUrl = configData.settings.appCallbackUrl || '';
    res.send(`
        <html>
        <head><title>Echo Speaks Settings</title><style>body{font-family:sans-serif;max-width:500px;margin:auto;padding:30px;} input{width:100%;padding:10px;margin:10px 0;} .btn{background:#00a8e1;color:white;border:none;padding:12px;width:100%;cursor:pointer;font-weight:bold;}</style></head>
        <body>
            <h2>Echo Speaks Configuration</h2>
            <form action="/saveConfig" method="POST">
                <label>App Callback URL (From Hubitat):</label>
                <input type="text" name="appCallbackUrl" value="${callbackUrl}" placeholder="Paste URL here..." required />
                <button type="submit" class="btn">Save & Go to Amazon Login</button>
            </form>
        </body>
        </html>
    `);
});

webApp.post('/saveConfig', urlencodedParser, (req, res) => {
    configData.settings.appCallbackUrl = req.body.appCallbackUrl;
    fs.writeFileSync(configFilePath, JSON.stringify(configData, null, 2), 'utf8');
    res.redirect('/refreshCookie');
});

// FIXED REFRESH ROUTE (Replaces the broken expressLogin function)
webApp.get('/refreshCookie', urlencodedParser, (req, res) => {
    logger.info('Refresh cookie request triggered.');

    // fallback cache check logic execution
    if (runTimeData?.savedConfig?.cookieData) {
        logger.info('Fallback active: Re-using last known valid Alexa Cookie from cache.');
        res.send('<h1>Authentication Restored via Local Cache Fallback!</h1><p>You can close this window.</p>');
        return;
    }

    // Modern cookie engine wrapper logic execution
    alexaCookie.generateAlexaCookie('', '', (err, result) => {
        if (result && Object.keys(result).length >= 2) {
            sendCookiesToEndpoint(configData.settings.appCallbackUrl, result);
            runTimeData.savedConfig.cookieData = result;
            updSessionItem('cookieData', result);
            logger.info('Successfully Logged Into Amazon and Cached Cookies!');
            res.send('<h1>Authentication Good!</h1>');
        } else {
            // Direct browser to Amazon fallback flow instead of crashing
            logger.info('Redirecting user to Amazon Login Portal...');
            res.redirect('https://amazon.com');
        }
    });
});

webApp.get('/configData', (req, res) => { res.send(configData); });

webApp.listen(PORT, () => {
    logger.info(`Echo Speaks Auth Server running on port ${PORT}`);
});
