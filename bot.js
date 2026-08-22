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
let restartTimer = null;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function start(number) {
    // Bersihkan timer restart sebelumnya
    if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
    }

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

    console.log("[INFO] Bot berhasil dibuat");

    /*
     * Restart koneksi setiap 30 menit
     */
    restartTimer = setTimeout(async () => {
        console.log("[INFO] Restart bot setelah 30 menit...");

        try {
            sock.end(undefined);
        } catch {}

        // Bersihkan cache pesan
        cache.clear();

        console.log("[INFO] Cache dibersihkan");

        // Tunggu sebentar sebelum membuat koneksi baru
        await sleep(3000);

        console.log("[INFO] Membuat koneksi baru...");

        start(number);
    }, 30 * 60 * 1000);

    /*
     * Pairing code
     */
    if (!sock.authState.creds.registered) {
        await sleep(3000);

        const code = await sock.requestPairingCode(number);

        console.log(`\n[INFO] Pairing code: ${code}`);
    }

    /*
     * Event handler
     */
    sock.ev.process(async (events) => {

        /*
         * Pesan masuk
         */
        events["messages.upsert"]?.messages.map(async (m) => {

            const conversation = await m.traverse(
                ".conversation",
                { group: 1 }
            );

            /*
             * Reply
             */
            m.reply = async (text, quoted) =>
                await sock.sendMessage(
                    m.key.remoteJid,
                    { text },
                    quoted
                );

            /*
             * Chat ID
             */
            m.chat = m.key.remoteJid;

            /*
             * Body pesan
             */
            m.body = [
                conversation,
                m.message?.imageMessage?.caption,
                m.message?.videoMessage?.caption,
                m.message?.documentMessage?.caption
            ]
                .find(
                    v =>
                        typeof v === "string" &&
                        v.trim()
                )
                ?.trim() || "";

            /*
             * Cache pesan
             */
            if (!m.key.fromMe) {

                const is_image =
                    m.message?.imageMessage;

                const is_audio =
                    m.message?.audioMessage;

                cache.set(m.key.id, {
                    name: m.pushName,
                    body: m.body,
                    msg: m,

                    /*
                     * Simpan image
                     */
                    image: is_image
                        ? await downloadMediaMessage(
                            m,
                            "buffer",
                            {},
                            {
                                logger: Pino({
                                    level: "silent"
                                }),
                                reuploadRequest:
                                    sock.updateMediaMessage
                            }
                        )
                        : null,

                    /*
                     * Simpan audio
                     */
                    audio: is_audio
                        ? await downloadMediaMessage(
                            m,
                            "buffer",
                            {},
                            {
                                logger: Pino({
                                    level: "silent"
                                }),
                                reuploadRequest:
                                    sock.updateMediaMessage
                            }
                        )
                        : null
                });
            }

            /*
             * Feature
             */
            m.message &&
                await feature(sock, m);
        });

        /*
         * Pesan dihapus
         */
        if (events["messages.update"]) {

            await Promise.all(
                events["messages.update"]
                    .filter(
                        u => u.update.message === null
                    )
                    .map(async (u) => {

                        const cache_data =
                            cache.get(u.key.id);

                        if (!cache_data) return;

                        /*
                         * Restore image
                         */
                        if (cache_data.image) {

                            await sock.sendMessage(
                                u.key.remoteJid,
                                {
                                    image:
                                        cache_data.image,

                                    caption:
                                        cache_data.msg
                                            .message
                                            ?.imageMessage
                                            ?.caption || ""
                                },
                                {
                                    quoted:
                                        cache_data.msg
                                }
                            );
                        }

                        /*
                         * Restore audio / VN
                         */
                        else if (cache_data.audio) {

                            await sock.sendMessage(
                                u.key.remoteJid,
                                {
                                    audio:
                                        cache_data.audio,

                                    mimetype:
                                        "audio/ogg; codecs=opus",

                                    ptt: true
                                },
                                {
                                    quoted:
                                        cache_data.msg
                                }
                            );
                        }

                        /*
                         * Restore text
                         */
                        else if (cache_data.body) {

                            await sock.sendMessage(
                                u.key.remoteJid,
                                {
                                    text:
                                        cache_data.body
                                },
                                {
                                    quoted:
                                        cache_data.msg
                                }
                            );
                        }
                    })
            );
        }

        /*
         * Simpan credentials
         */
        events["creds.update"] &&
            await saveCreds();
    });
}

/*
 * Start bot
 */
start("6283173655769");
