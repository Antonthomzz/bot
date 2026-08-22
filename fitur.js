import "@antonthomzz/travex";
import got from "got";
import { downloadContentFromMessage } from "@whiskeysockets/baileys";


const downloadMedia = async (media, type) => {
    const stream = await downloadContentFromMessage(media, type);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    return buffer;
},

quote = {
    quoted: {
        key: {
            remoteJid: '0@s.whatsapp.net',
            fromMe: false,
            participant: '0@s.whatsapp.net'
        },
        message: {
            newsletterAdminInviteMessage: {
                newsletterJid: '123@newsletter',
                caption: `Bot Whatsapp`,
                inviteExpiration: 0
            }
        }
    }
};

export const feature = async (sock, m) => {
    console.log(`[${m.pushName}]: ${m.body}`);
    
    try {
        // Auto download TikTok video
        for (const [url] of m.body.matchAll(/https?:\/\/(?:vt|vm|www)?\.?tiktok\.com\/[^\s]+/gi)) {
            try {
                const { body: res } = await got.post("https://www.tikwm.com/api/", {
                    form: {
                        url,
                        hd: 1
                    },
                    responseType: "json"
                });

                if (res?.data?.play) await sock.sendMessage(m.chat, { video: { url: res.data.play } }, { quoted: {
        key: {
            remoteJid: '0@s.whatsapp.net',
            fromMe: false,
            participant: '0@s.whatsapp.net'
        },
        message: {
            conversation: "Vidio TikTok di download"
        }
    }});
            } catch {
                m.reply("gagal download vidio tiktok", quote);
            }
        }
        

        // Auto download Facebook video
        for (const [url] of m.body.matchAll(/https?:\/\/(?:www\.)?facebook\.com\/(?:reel\/\d+|share\/r\/[a-zA-Z0-9]+)/g)) {
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
                const video_url = search_url_data[["browser_native_hd_url", "browser_native_sd_url"].find(key => search_url_data[key])];

                if (video_url) await sock.sendMessage(m.chat, { video: { url: video_url } }, quote);
            } catch {
                m.reply("gagal download vidio facebook", quote);
            }
        }


        // save media viewonce
        if (["/save", "🗿", "pret", "krm"].some(v => m.body.includes(v))) {
            if (!m.key.fromMe) return;

            const quote = m.traverse(".quotedMessage", { group: 1 });
            if (!quote) return;

            const mediaType = Object.keys(quote).find(v => v === "imageMessage" || v === "videoMessage");
            if (!mediaType) return;

            const typeMap = { imageMessage: "image", videoMessage: "video" };
            const media = quote[mediaType];
            if (!media?.mediaKey || !media?.directPath) return;

            const mime = media?.mimetype || "";
            const caption = media?.caption || "";
            const buffer = await downloadMedia(media, typeMap[mediaType]);

            await sock.sendMessage("6283173655769@s.whatsapp.net", { [typeMap[mediaType]]: buffer, mimetype: mime, caption: caption || undefined }, quote);
        }
    } catch (error) {
        console.error("Error message:", error.message);
    }
}
