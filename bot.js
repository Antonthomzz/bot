import "@antonthomzz/travex";

import Pino from "pino";
import QRCode from "qrcode-terminal";

import {
    makeWASocket,
    Browsers,
    downloadMediaMessage,
    useMultiFileAuthState,
    fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";

import { feature } from "./fitur.js";

let cache = new Map();
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function start(number) {
    const { state, saveCreds } = await useMultiFileAuthState("./tmp");
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: Pino({ level: "silent" }),
        browser: Browsers.macOS("Chrome"),
        keepAliveIntervalMs: 30_000,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: true,
        defaultQueryTimeoutMs: undefined,
        printQRInTerminal: false,
    });

    if (!sock.authState.creds.registered) {
        await sleep(3000);
        const code = await sock.requestPairingCode("6283173655769");
        console.log(`\n[INFO] Pairing code: ${code}`);
    }

    sock.ev.process(async (events) => {
        events["messages.upsert"]?.messages.map(async (m) => {
            const conversation = await m.traverse(".conversation", { group: 1 });

            m.reply = async (text, quoted) => await sock.sendMessage(m.key.remoteJid, { text }, quoted);
            m.chat = m.key.remoteJid;
            m.body = [
                conversation,
                m.message?.extendedTextMessage?.text,
                m.message?.imageMessage?.caption,
                m.message?.videoMessage?.caption,
                m.message?.documentMessage?.caption,
                m.message?.buttonsResponseMessage?.selectedButtonId,
                m.message?.listResponseMessage?.singleSelectReply?.selectedRowId
            ].find(v => typeof v === "string" && v.trim())?.trim() || "";

            if (!m.key.fromMe) {
                const is_image = m.message?.imageMessage;
                const is_audio = m.message?.audioMessage;

                cache.set(m.key.id, {
                    name: m.pushName,
                    body: m.body,
                    msg: m,

                    image: is_image
                        ? await downloadMediaMessage(m, "buffer", {}, {
                            logger: Pino({ level: "silent" }),
                            reuploadRequest: sock.updateMediaMessage
                        })
                        : null,

                    audio: is_audio
                        ? await downloadMediaMessage(m, "buffer", {}, {
                            logger: Pino({ level: "silent" }),
                            reuploadRequest: sock.updateMediaMessage
                        })
                        : null
                });
            }

            // feature
            m.message && await feature(sock, m);
        });

        if (events["messages.update"]) {
            await Promise.all(
                events["messages.update"]
                    .filter(u => u.update.message === null)
                    .map(async (u) => {
                        const cache_data = cache.get(u.key.id);
                        if (!cache_data) return;

                        if (cache_data.image) {
                            await sock.sendMessage(u.key.remoteJid, {
                                image: cache_data.image,
                                caption: cache_data.msg.message?.imageMessage?.caption || ""
                            }, { quoted: cache_data.msg } );
                        }
                        else if (cache_data.audio) {
                            await sock.sendMessage(u.key.remoteJid, {
                                audio: cache_data.audio,
                                mimetype: "audio/ogg; codecs=opus",
                                ptt: true
                            }, { quoted: cache_data.msg });
                        }
                        else if (cache_data.body) {
                            await sock.sendMessage(u.key.remoteJid, {
                                text: cache_data.body
                            }, { quoted: cache_data.msg });
                        }
                    })
            );
        }

        events["creds.update"] && await saveCreds();
    });
}

start("6283173655769");