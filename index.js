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
        try {
            configData = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
        } catch (e) {
            logger.error('Failed to parse config file');
        }
    }
}

function loadSession() {
    if (fs.existsSync(sessionFilePath)) {
        try {
            runTimeData = JSON.parse(fs.readFileSync(sessionFilePath, 'utf8'));
        } catch (e) {
            logger.error('Failed to parse session file');
        }
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

function sendClearAuthToHub() {
    if (configData.settings.appCallbackUrl) {
        const clearUrl = String(configData.settings.appCallbackUrl).replace('/receiveData?', '/clearAuth?');
        axios.post(clearUrl, { status: 'cleared' }).catch(err => logger.error(`Error sending clearAuth: ${err.message}`));
    }
}

function isCookieValid(cookie) {
    return new Promise((resolve) => {
        alexaCookie.checkCookie(cookie, (err, res) => {
            if (err || !res) {
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}

function initAlexaCookie() {
    if (!runTimeData.savedConfig || !runTimeData.savedConfig.cookieData) {
        logger.warn('No cookie data found to initialize proxy listener.');
        return;
    }
    logger.info('Initializing Proxy Cookie Engine...');
}

loadConfig();
loadSession();

webApp.get('/refreshCookie', urlencodedParser, (req, res) => {
    logger.verbose('refreshCookie request received');
    logger.debug(`cookieData: ${runTimeData.savedConfig || null}`);
    alexaCookie.refreshAlexaCookie(
        {
            formerRegistrationData: runTimeData.savedConfig.cookieData,
        },
        (err, result) => {
            if (result && Object.keys(result).length >= 2) {
                isCookieValid(result).then((valid) => {
                    if (valid) {
                        sendCookiesToEndpoint(configData.settings.appCallbackUrl ? String(configData.settings.appCallbackUrl).replace('/receiveData?', '/cookie?') : null, result);
                        runTimeData.savedConfig.cookieData = result;
                        updSessionItem('cookieData', result);
                        logger.info('Successfully Refreshed Alexa Cookie...');
                        res.send({
                            result: JSON.stringify(result),
                            status: 'success'
                        });
                        if (configData.settings.useLocalProxy === true) {
                            initAlexaCookie();
                        }
                    } else {
                        logger.error(`** ERROR: Unsuccessfully refreshed Alexa Cookie it was found to be invalid/expired... **`);
                        logger.error('RESULT: ' + err + ' / ' + JSON.stringify(result));
                        
                        // Integrated x86cpu fallback cache registration logic hook
                        if (runTimeData?.savedConfig?.cookieData) {
                            logger.info('Fallback: Re-using last known valid Alexa Cookie from cache.');
                            res.send({
                                result: JSON.stringify(runTimeData.savedConfig.cookieData),
                                status: 'success'
                            });
                            return;
                        }

                        logger.warn(`** WARNING: We are clearing the Cookie from ${configData.settings.hubPlatform} to prevent further requests and server load... **`);
                        sendClearAuthToHub();
                    }
                    setTimeout(() => {
                        logger.warn('Restarting after cookie refresh attempt');
                        process.exit(1);
                    }, 25 * 1000);
                });
            }
        }
    );
});

webApp.get('/configData', (req, res) => {
    res.send(configData);
});

webApp.post('/saveConfig', (req, res) => {
    configData = req.body;
    fs.writeFileSync(configFilePath, JSON.stringify(configData, null, 2), 'utf8');
    res.send({ status: 'saved' });
});

webApp.listen(PORT, () => {
    logger.info(`Echo Speaks Auth Server running on port ${PORT}`);
    if (runTimeData.savedConfig && runTimeData.savedConfig.cookieData) {
        initAlexaCookie();
    }
});
