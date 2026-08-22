import "@antonthomzz/travex";
import got from "got";
import Pino from "pino";
import {
    makeWASocket,
    Browsers,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    downloadContentFromMessage
} from "@whiskeysockets/baileys";

let pairingRequested = false;
let restartTimer = null;

const downloadMedia = async (media, type) => {
    const stream = await downloadContentFromMessage(media, type);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    return buffer;
};

const quote = text => ({
    quoted: {
        key: {
            remoteJid: "0@s.whatsapp.net",
            fromMe: false,
            participant: "0@s.whatsapp.net"
        },
        message: {
            conversation: text
        }
    }
});

async function start(number) {
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
        generateHighQualityLinkPreview: false,
        defaultQueryTimeoutMs: undefined
    });

    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
        if (qr && !state.creds.registered && !pairingRequested) {
            pairingRequested = true;
            try {
                const code = await sock.requestPairingCode(number.replace(/\D/g, ""));
                console.log("[WA] Pairing Code:", code.match(/.{1,4}/g)?.join("-"));
            } catch (error) {
                pairingRequested = false;
                console.error("[WA] Pairing error:", error?.message || error);
            }
        }

        if (connection === "open") {
            pairingRequested = false;
            console.log("[WA] Connected");
            return;
        }

        if (connection !== "close") return;

        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log("[WA] Connection closed:", statusCode || "unknown");

        if (statusCode === DisconnectReason.loggedOut) {
            pairingRequested = false;
            console.log("[WA] Logged out");
            return;
        }

        if (!state.creds.registered) {
            console.log("[WA] Waiting for pairing...");
            return;
        }

        if (restartTimer) return;

        restartTimer = setTimeout(() => {
            restartTimer = null;
            start(number);
        }, 3000);
    });

    sock.ev.process(async events => {
        const upsert = events["messages.upsert"];

        if (upsert?.messages) {
            for (const m of upsert.messages) {
                const body = [
                    m.message?.conversation,
                    m.message?.extendedTextMessage?.text,
                    m.message?.imageMessage?.caption,
                    m.message?.videoMessage?.caption,
                    m.message?.documentMessage?.caption,
                    m.message?.buttonsResponseMessage?.selectedDisplayText,
                    m.message?.listResponseMessage?.title,
                    m.message?.listResponseMessage?.description,
                    m.message?.templateButtonReplyMessage?.selectedDisplayText,
                    m.message?.interactiveResponseMessage?.body?.text,
                    m.message?.editedMessage?.message?.conversation,
                    m.message?.editedMessage?.message?.extendedTextMessage?.text
                ].find(v => typeof v === "string" && v.trim())?.trim() || "";

                for (const [url] of body.matchAll(/https?:\/\/(?:vt|vm|www)?\.?tiktok\.com\/[^\s]+/gi)) {
                    try {
                        const { body: res } = await got.post("https://www.tikwm.com/api/", {
                            form: { url, hd: 1 },
                            responseType: "json"
                        });

                        if (!res?.data?.play) continue;

                        await sock.sendMessage(m.key.remoteJid, { video: { url: res.data.play }}, quote("Download TikTok Video!"));
                    } catch (error) {
                        console.error("[TikTok]", error?.message || error);
                    }
                }

                for (const [url] of body.matchAll(/https?:\/\/(?:www\.)?facebook\.com\/(?:reel\/\d+|share\/r\/[a-zA-Z0-9]+)/gi)) {
                    try {
                        const html = await got(url, {
                            headers: {
                                accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
                                "accept-language": "id-MM,id-ID;q=0.9,id;q=0.8,en-US;q=0.7,en;q=0.6",
                                "cache-control": "max-age=0",
                                priority: "u=0, i",
                                "sec-ch-prefers-color-scheme": "dark",
                                "sec-ch-ua": "\"Not;A=Brand\";v=\"8\", \"Chromium\";v=\"150\", \"Google Chrome\";v=\"150\"",
                                "sec-ch-ua-mobile": "?0",
                                "sec-ch-ua-model": "\"\"",
                                "sec-ch-ua-platform": "\"Linux\"",
                                "sec-ch-ua-platform-version": "\"\"",
                                "sec-fetch-dest": "document",
                                "sec-fetch-mode": "navigate",
                                "sec-fetch-site": "same-origin",
                                "sec-fetch-user": "?1",
                                "upgrade-insecure-requests": "1",
                                "viewport-width": "150"
                            }
                        }).text();

                        const search_json_data = await html.findall("data-sjs>({.*?ScheduledServerJS.*?})</script>");
                        const search_url_data = search_json_data.traverse("#videoDeliveryLegacyFields", { group: 1 });

                        const key = ["browser_native_hd_url", "browser_native_sd_url"].find(key => search_url_data?.[key]);
                        const video_url = key ? search_url_data[key] : null;

                        if (!video_url) continue;

                        await sock.sendMessage(m.key.remoteJid, { video: { url: video_url }}, quote("Download Facebook Video!"));
                    } catch (error) {
                        console.error("[Facebook]", error?.message || error);
                    }
                }

                if (["/save", "🗿", "pret", "/download"].some(v => body.includes(v))) {
                    if (!m.key.fromMe) continue;

                    const quotedMessage = m.traverse(".quotedMessage", { group: 1 });
                    if (!quotedMessage) continue;

                    const mediaType = Object.keys(quotedMessage).find(type => type === "imageMessage" || type === "videoMessage");
                    if (!mediaType) continue;

                    const typeMap = {
                        imageMessage: "image",
                        videoMessage: "video"
                    };

                    const media = quotedMessage[mediaType];
                    if (!media?.mediaKey || !media?.directPath) {
                        continue;
                    }

                    const mime = media.mimetype || "";
                    const caption = media.caption || "";
                    const buffer = await downloadMedia(media, typeMap[mediaType]);

                    await sock.sendMessage(m.key.remoteJid, {
                        [typeMap[mediaType]]: buffer,
                        mimetype: mime || undefined,
                        caption: caption || undefined
                    }, quote("Download Media!"));
                }
            }
        }

        if (events["creds.update"]) {
            await saveCreds();
        }
    });

    return sock;
}

start("6283173655769");
