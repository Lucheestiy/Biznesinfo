#!/usr/bin/env python3
"""
Generate emotional feminine TTS using edge-tts with SSML prosody control.
Uses higher pitch, slightly slower rate, and expressive pauses for a warmer,
more feminine and emotional reading.
"""
import asyncio
import edge_tts

TEXT = """<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
       xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="ru-RU">
  <voice name="ru-RU-SvetlanaNeural">
    <mstts:express-as style="empathetic" styledegree="2">
      <prosody rate="-8%" pitch="+12%">

        Пора вернуть себе СВОБОДУ и ЖЕНСТВЕННОСТЬ!

        <break time="600ms"/>

        <prosody rate="-12%" pitch="+15%">
        Представь: ты выдыхаешь, <break time="300ms"/> снимаешь маски, <break time="300ms"/>
        разрешаешь телу двигаться так, как хочет оно, <break time="200ms"/>
        а голосу — звучать свободно и сексуально.
        </prosody>

        <break time="500ms"/>

        Без оценки, без рамок.

        <break time="700ms"/>

        <prosody rate="-5%" pitch="+10%">
        Приглашаем тебя на выездной ретрит «Свобода. Опора. Тело»
        в лавандовую усадьбу недалеко от Минска.
        </prosody>

        <break time="600ms"/>

        <prosody rate="-6%" pitch="+13%">
        Ты получишь за 2 дня:

        <break time="400ms"/>

        Раскрепощение тела — <break time="200ms"/> танцевальная практика уберёт зажимы и блоки.
        <break time="300ms"/>
        Настоящий женский голос — <break time="200ms"/> природный, харизматичный, притягательный.
        <break time="300ms"/>
        Актёрские техники для лёгкости и творчества.
        <break time="300ms"/>
        Новый взгляд на самоценность — <break time="200ms"/> ты перестанешь доказывать и начнёшь жить.
        </prosody>

        <break time="700ms"/>

        <prosody rate="-5%" pitch="+10%">
        Программа:

        <break time="400ms"/>

        20 июня, первый день — тело и чувственность с Татьяной Рать:
        <break time="300ms"/>
        Танцевально-двигательная практика на расслабление и раскрепощение.
        <break time="200ms"/>
        Актёрское мастерство плюс элементы творчества.
        <break time="200ms"/>
        Теория: природный голос и женская сексуальность.
        <break time="200ms"/>
        Практика раскрытия женственного, сексуального, харизматичного голоса.

        <break time="500ms"/>

        21 июня, второй день — женский коуч Елена Сурдо:
        <break time="300ms"/>
        Самоценность как путь к внутренней свободе.
        <break time="200ms"/>
        Работа с ограничивающими убеждениями.
        <break time="200ms"/>
        Трансформация негативных установок в поддерживающие.
        <break time="200ms"/>
        Ритуал «Освобождение» — мягкая очищающая практика.
        </prosody>

        <break time="600ms"/>

        Где: усадьба «Лаванда», Витебская область, Докшинский район, деревня Отруб.
        <break time="200ms"/>
        Живописное место, всего 40 минут от Минска.

        <break time="400ms"/>

        Когда: 20 — 21 июня.

        <break time="600ms"/>

        <prosody rate="-10%" pitch="+15%">
        Ретрит проходит в душевном месте, <break time="200ms"/>
        где каждой хватит внимания и тепла.
        </prosody>

        <break time="500ms"/>

        Запись: в личные сообщения или по телефону:
        <break time="200ms"/>
        плюс 375, 29, 639, 85, 39.

        <break time="700ms"/>

        <prosody rate="-12%" pitch="+15%">
        Добро пожаловать в мир, <break time="300ms"/>
        где женственность — это не роль, <break time="300ms"/>
        а твоя природа.
        </prosody>

        <break time="600ms"/>

        <prosody rate="-8%" pitch="+12%">
        Напиши «Хочу» прямо сейчас — <break time="200ms"/>
        и мы сохраним для тебя место!
        </prosody>

        <break time="500ms"/>

        Ловите момент и успевайте!

        <break time="300ms"/>

        Запись личным сообщением или по номеру:
        <break time="200ms"/>
        плюс 375, 29, 639, 85, 39.

      </prosody>
    </mstts:express-as>
  </voice>
</speak>"""

OUTPUT_FILE = "/home/mlweb/biznesinfo.lucheestiy.com/.tmp/retreat_emotional.mp3"

async def main():
    communicate = edge_tts.Communicate(TEXT, voice="ru-RU-SvetlanaNeural")
    await communicate.save(OUTPUT_FILE)
    print(f"Done! Saved to {OUTPUT_FILE}")

if __name__ == "__main__":
    asyncio.run(main())
