# Glossary: Tyne's own words in every language

Tyne's own strings live in two catalogues: the web's, here (`fork_locales/<locale>/messages.po`),
and the phone's, in tyne-mobile (`l10n_fork/fork_<locale>.arb`). A feature should read the same in
both apps and on every screen, so Tyne's own concepts get one word per language, the one below.
When you translate a fork string, use these words, inflected as the language needs; when you add a
language or a term, take the word the catalogues already use most and add it here. (In October 2026
the strings for pinning an emoji to a persona said 人设 in Chinese while 90 others said 人格; a
glossary would have caught that.)

## Rules

- **Names** stay as they are: Tyne, Fluxer, PluralKit.
- **Upstream's concepts** (communities, channels, roles, reactions, favourites, emoji) take
  upstream's word in the same language, from upstream's catalogue (`../locales/<locale>/messages.po`
  on the web, `lib/l10n/fluxer_<locale>.arb` on the phone). Do not coin a second word for them.
- **Persona** is always the word in the table, also inside a longer phrase and with the language's
  endings ("personaként", "την persona"). Never a near word that means something else: not
  "character" or "role" (Chinese 角色), "personality" (Hindi व्यक्तित्व) or "identity" (Thai ตัวตน).
  Where the table has the Latin "persona", keep it Latin, with the capital as the table writes it.
- **Pin** is pinning an emoji to the front of the frequently used emojis, for the account or for one
  persona ("Pin for this persona"). It is not pinning a message or a DM, which upstream translates
  in its own catalogues.
- **Capitals** follow each app's style: the phone writes headings in title case ("Display Tag"),
  the web in sentence case ("Display tag"). That is style, not a different word.

## Terms

- **Persona**: one of several identities under one account, for plural systems and anyone who writes
  as more than one person. Messages, reactions and signals can come from a persona.
- **Display tag**: the short text or icon shown after a persona's name, so others can tell the
  account behind it.
- **Signature emojis**: a persona's own emojis; reacting with one reacts as that persona.
- **Signal bar**: the row of emoji above the message box; a click lights a signal (or turns it off)
  as the account or the persona being written as.
- **Pin** (an emoji): see the rules above.
- **React as…**: reacting as a persona picked from a list.

## Words per language

The web's locale code first, then the phone's. Taken from both catalogues on 2026-10-25. The phone
also has `en_US` and `pt` (Portugal), which use the words of `en_GB` and `pt_BR`.

| Language (web / phone) | Persona | Personas | Display tag | Signature emojis | Signal bar | Pin emoji | React as… |
|---|---|---|---|---|---|---|---|
| Arabic (`ar`) | شخصية | الشخصيات | علامة العرض | الرموز التعبيرية المميزة | شريط الإشارات | تثبيت الرمز التعبيري | تفاعل باسم... |
| Bulgarian (`bg`) | Персона | Персони | Таг за показване | Подписни емоджита | Лента със сигнали | Закачане на емоджи | Реагиране като... |
| Czech (`cs`) | Persona | Persony | Zobrazovaná značka | Podpisové emoji | Lišta signálů | Připnout emoji | Reagovat jako... |
| Danish (`da`) | Persona | Personaer | Visningstag | Signatur-emojis | Signalbjælke | Fastgør emoji | Reager som... |
| German (`de`) | Persona | Personas | Anzeige-Tag | Signatur-Emojis | Signalleiste | Emoji anheften | Reagieren als... |
| Greek (`el`) | Persona | Persona | Ετικέτα εμφάνισης | Χαρακτηριστικά emoji | Γραμμή σημάτων | Καρφίτσωμα emoji | Αντίδραση ως... |
| English (UK) (`en-GB` / `en_GB`) | Persona | Personas | Display tag | Signature Emojis | Signal bar | Pin emoji | React as... |
| Spanish (`es-ES` / `es`) | Persona | Personas | Etiqueta de visualización | Emojis de firma | Barra de señales | Fijar emoji | Reaccionar como... |
| Spanish (Latin America) (`es-419` / `es_419`) | Persona | Personas | Etiqueta de visualización | Emojis distintivos | Barra de señales | Fijar emoji | Reaccionar como... |
| Finnish (`fi`) | Persoona | Persoonat | Näyttötunniste | Nimikkoemojit | Signaalipalkki | Kiinnitä emoji | Reagoi käyttäjänä... |
| French (`fr`) | Persona | Personas | Badge d'affichage | Emojis signature | Barre de signaux | Épingler l'émoji | Réagir en tant que... |
| Hebrew (`he`) | פרסונה | פרסונות | תגית תצוגה | אימוג'י חתימה | סרגל אותות | הצמד אימוג'י | הגב בתור... |
| Hindi (`hi`) | परसोना | परसोना | डिस्प्ले टैग | हस्ताक्षर इमोजी | सिग्नल बार | इमोजी पिन करें | के रूप में प्रतिक्रिया दें... |
| Croatian (`hr`) | Persona | Persone | Oznaka prikaza | Prepoznatljivi emojiji | Traka signala | Prikvači emotikon | Reagiraj kao... |
| Hungarian (`hu`) | Persona | Personák | Megjelenítési címke | Aláírási hangulatjelek | Jelzősáv | Hangulatjel rögzítése | Reakció mint... |
| Indonesian (`id`) | Persona | Persona | Tag Tampilan | Emoji Tanda Tangan | Bilah Sinyal | Sematkan emoji | Bereaksi sebagai... |
| Italian (`it`) | Persona | Persona | Tag di visualizzazione | Emoji distintive | Barra dei segnali | Fissa emoji | Reagisci come... |
| Japanese (`ja`) | ペルソナ | ペルソナ | 表示タグ | シグネチャー絵文字 | シグナルバー | 絵文字をピン留め | 別名でリアクション... |
| Korean (`ko`) | 페르소나 | 페르소나 | 표시 태그 | 시그니처 이모지 | 시그널 바 | 이모지 고정 | 다른 프로필로 반응하기... |
| Lithuanian (`lt`) | Persona | Personos | Rodoma žyma | Parašo jaustukai | Signalų juosta | Prisegti jaustuką | Reaguoti kaip... |
| Norwegian (`no` / `nb`) | Persona | Personaer | Visningstag | Signaturemojier | Signallinje | Fest emoji | Reager som... |
| Dutch (`nl`) | Persona | Persona's | Weergavetag | Handtekening-emoji's | Signaalbalk | Emoji vastpinnen | Reageren als... |
| Polish (`pl`) | Persona | Persony | Widoczny tag | Emoji podpisu | Pasek sygnałów | Przypnij emoji | Zareaguj jako... |
| Portuguese (Brazil) (`pt-BR` / `pt_BR`) | Persona | Personas | Tag de exibição | Emojis de assinatura | Barra de sinais | Fixar emoji | Reagir como... |
| Romanian (`ro`) | Persona | Personas | Etichetă de afișare | Emoji-uri semnătură | Bara de semnale | Fixează emoji | Reacționează ca... |
| Russian (`ru`) | Персона | Персоны | Отображаемый тег | Фирменные эмодзи | Панель сигналов | Закрепить эмодзи | Реагировать как... |
| Swedish (`sv-SE` / `sv`) | Persona | Personas | Visningstagg | Signaturemojier | Signalfält | Fäst emoji | Reagera som... |
| Thai (`th`) | Persona | Persona | แท็กแสดงผล | อีโมจิประจำตัว | แถบสัญญาณ | ปักหมุดอีโมจิ | แสดงความรู้สึกในฐานะ... |
| Turkish (`tr`) | Persona | Personalar | Görünen Etiket | İmza Emojileri | Sinyal Çubuğu | Emojiyi sabitle | Farklı bir profil olarak tepki ver... |
| Ukrainian (`uk`) | Персона | Персони | Значок відображення | Фірмові емодзі | Панель сигналів | Закріпити емодзі | Відреагувати як... |
| Vietnamese (`vi`) | Persona | Persona | Thẻ hiển thị | Biểu tượng cảm xúc đặc trưng | Thanh tín hiệu | Ghim biểu tượng cảm xúc | Thả cảm xúc dưới tên... |
| Chinese (Simplified) (`zh-CN` / `zh`) | 人格 | 人格 | 显示标签 | 专属表情符号 | 信号栏 | 置顶表情 | 回应身份... |
| Chinese (Traditional) (`zh-TW` / `zh_Hant`) | 人格 | 人格 | 顯示標籤 | 專屬表情符號 | 訊號列 | 釘選表情符號 | 回應身分... |

## Not yet aligned

These strings use another word than the table and should change to it:

- "Signature emoji already in use by persona \"{name}\"", "Maximum {max} signature emojis allowed per
  persona" (web only) and "Reacting with a signature emoji will always react as this persona,
  regardless of active persona.", in both apps: Chinese 角色, Hindi व्यक्तित्व, Thai ตัวตน and Greek
  περσόνα instead of the persona word.
- Spanish (Latin America): the web says "Emojis distintivos" for signature emojis, the phone
  "Emojis de firma".
- Italian: the web leaves the plural "Persona", the phone writes "Personas".
