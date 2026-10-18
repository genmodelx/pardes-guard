# Reviewing the machine-drafted languages

Hindi (`hi`), Bengali (`bn`), Nepali (`ne`) and Filipino (`fil`) were drafted by the AI model that
built this version, not by Gemini and not by a person: no Google service could be reached from the
build machine. Every screen in these languages says "machine translation" and links to English.

Each file here is that language's glossary (the fixed words for the app's own terms) and the
questions the draft left open.

To review a language:

1. Read the app in it (`/hi/home/` and so on) next to English.
2. Change strings in `lib/i18n/locales/<code>.ts`. Keep every `{placeholder}`, write digits as 0-9,
   and add no links, fees or phone numbers. `npm test` checks all of this.
3. Keep a word from the glossary the same everywhere, or change it everywhere.
4. When a native speaker has read every string, remove the code from `MACHINE_LOCALES` in
   `lib/i18n/config.ts`. The "machine translation" line then goes away, and the tests require the
   language to have every string, staff screens included.
