# TOOLS.md - Local Notes

Skills define *how* tools work. This file is for *your* specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:
- Camera names and locations
- SSH hosts and aliases  
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras
- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH
- home-server → 192.168.1.100, user: admin

### TTS
- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

Add whatever helps you do your job. This is your cheat sheet.

### Telegram CLI Bridge
- Если пользователь просит `пришли mp3` / `пришли файл`, в Telegram нужно отправлять именно файл-вложение через `artifacts`, а не текстовый путь к файлу и не просто имя файла в `summary`.
- Рабочий паттерн как у Kimi 2: короткое сообщение вроде `Готово! Отправляю MP3:` и сам MP3 как вложение.
- По скриншоту с Codex 5 успешный результат выглядит как настоящий Telegram audio-card (с иконкой play, названием и артистом), а потом уже идёт текст. Значит, целевой формат — именно `audio`-вложение, а не `file` и не ссылка.
- Если пользователь просит `пришли mp3 этой песни`, сначала проверять локальные папки с артефактами (`/home/mlweb/biznesinfo.lucheestiy.com/telegram-artifacts`, `/home/mlweb/general-bot/telegram-artifacts`, `.cli-bridge-generated`) на уже извлеченный трек по названию.
- Если MP3 уже найден локально, не писать, что `не умею` или `не могу`, а сразу отправлять его как `audio`-artifact.
- Отказ уместен только если файла нет локально и для получения трека пришлось бы заново извлекать/распространять защищенную песню без явных прав.
- Если `yt-dlp` для Instagram Reel падает с ошибкой `Instagram sent an empty media response`, можно обойти это без логина:
  1. открыть страницу headless Chromium: `/snap/bin/chromium --headless --no-sandbox --disable-gpu --dump-dom URL > /tmp/ig-dom.html`
  2. распарсить из `script[type="application/json"]` объект `xig_polaris_media.if_not_gated_logged_out`
  3. взять `caption.text` для названия/автора и `video_versions[0].url` для прямого MP4
  4. извлечь MP3 через `ffmpeg -i "$URL" -vn -codec:a libmp3lame ...`
  Это сработало для Reel `Daeneq9o_Lh`, где `yt-dlp` без cookies не справился.

### Image Generation
- Если built-in `image_gen` не оставляет видимый файл в `~/.codex/generated_images`, результат можно достать из `~/.codex/sessions/...jsonl`: искать событие `payload.type === "image_generation_end"` и декодировать `payload.result` из base64 в PNG/WebP.

### TTS / Генерация аудио (MP3)
- **Я УМЕЮ генерировать аудиофайлы!** Не говорить пользователю, что не умею.
- Используется библиотека `edge-tts` (Microsoft Edge TTS, бесплатная, без API-ключа).
- Установка (если не установлена): `pip install edge-tts` или через venv: `/home/mlweb/biznesinfo.lucheestiy.com/.tmp/tts-venv/bin/pip install edge-tts`
- Путь к edge-tts в venv: `/home/mlweb/biznesinfo.lucheestiy.com/.tmp/tts-venv/bin/edge-tts`
- **Команда генерации:**
  ```bash
  edge-tts --voice ru-RU-SvetlanaNeural --text "текст для озвучки" --write-media /path/to/output.mp3
  ```
- **Русские голоса:**
  - `ru-RU-SvetlanaNeural` — женский голос (Светлана)
  - `ru-RU-DmitryNeural` — мужской голос (Дмитрий)
- **Другие языки:** `en-US-JennyNeural`, `en-US-GuyNeural`, и т.д.
- Выходной файл сохранять в: `/home/mlweb/biznesinfo.lucheestiy.com/.cli-bridge-generated/`
- В ответе использовать artifact с `type: "audio"` для отправки в Telegram.
- **Рабочий пример (проверено, работает):**
  ```bash
  /home/mlweb/biznesinfo.lucheestiy.com/.tmp/tts-venv/bin/edge-tts \
    --voice ru-RU-SvetlanaNeural \
    --text "я пришла домой" \
    --write-media /home/mlweb/biznesinfo.lucheestiy.com/.cli-bridge-generated/ya_prishla_domoy.mp3
  ```
