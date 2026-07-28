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

webApp.get('/', (req, res) => {
    res.send('<h1>Echo Speaks Background Proxy Active</h1><p>Automatic refreshing is managed via Hubitat.</p>');
});

// AUTOMATED REFRESH ENGINE WITH BROWSER EMULATION
webApp.get('/refreshCookie', urlencodedParser, (req, res) => {
    logger.info('Automated background token refresh requested...');

    const refreshOptions = {
        formerRegistrationData: runTimeData.savedConfig?.cookieData,
        // Emulate a standard desktop browser environment to satisfy Amazon's security
        setupProxy: true,
        useBridge: true,
        puppeteerOptions: {
            executablePath: '/usr/bin/chromium-browser',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        }
    };

    alexaCookie.refreshAlexaCookie(refreshOptions, (err, result) => {
        if (result && Object.keys(result).length >= 2) {
            sendCookiesToEndpoint(configData.settings.appCallbackUrl, result);
            runTimeData.savedConfig.cookieData = result;
            updSessionItem('cookieData', result);
            logger.info('SUCCESS: Background cookies silently updated and saved!');
            res.send({ status: 'success', message: 'Automated background refresh successful.' });
        } else {
            logger.error(`Automated refresh failed: ${err || 'Amazon rejected credentials'}`);
            
            // X86CPU Cache Fallback protection activation loop
            if (runTimeData?.savedConfig?.cookieData) {
                logger.warn('Engaging x86cpu fallback: Providing previously cached session state.');
                res.send({ result: JSON.stringify(runTimeData.savedConfig.cookieData), status: 'success' });
                return;
            }
            res.status(500).send({ status: 'failed', error: 'Automated refresh failed completely.' });
        }
    });
});

webApp.get('/configData', (req, res) => { res.send(configData); });

webApp.listen(PORT, () => {
    logger.info(`Echo Speaks Automated Server active on port ${PORT}`);
});
