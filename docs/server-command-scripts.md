# Server command scripts

A reference for writing Tyne's server command scripts: for an LLM helping someone write one, and for
people who know Liquid and want the differences. Every example was run on the server's engine.

A server command is a slash command a community defines, such as `/tuck`. When a member runs it, the
server fills in its script once and posts the result as an ordinary message from that member. A
script is Liquid with most of it removed: no loops, no other files, and nothing is remembered
between runs, except counters.

## Writing a script for someone

Give these fields, for Community Settings > Commands > New command > Use the script editor (web and
desktop):

- **Name:** 1-32 lowercase letters, digits, `-` or `_`. Not one of: shrug, tableflip, unflip, me,
  spoiler, tts, nick, kick, ban, dm, msg, saved, favorites, sticker, gif, persona.
- **Description:** optional, at most 100 characters.
- **Input:** None (running it with text is refused), Optional, or Required (running it without text
  is refused).
- **Script:** in a code block, at most 4,000 characters.
- **Counters:** optional, see "Counters".

Use only what this page lists. Liquid you remember from elsewhere may not work here, so read
"Differences from standard Liquid" before answering. Then:

- Put every `assign` at the very top of the script, before any text, so it leaves no empty lines.
- Handle anything a member could type: nothing, a word, a number, a mention.
- If the command takes input, say what it posts for each of those.
- If something cannot be done here, such as remembering a count, say so instead of faking it.

## Variables

- `person`: who ran it. Prints as a mention, which notifies them. `person.name` is their name.
- `input`: what they typed, one line, `""` if nothing. Mentions stay as `<@123>` or `<@123:456>` and
  custom emoji as `<:name:789>`.
- `target`: the first person mentioned in `input`, or nil. Prints as a mention, which notifies them.
  `target.name` is their name, empty if nil.
- `channel`: prints as a channel link. `channel.name` is its name. `channel.community.name` is the
  community it is in. In a DM, `channel` and `channel.community.name` are empty.
- `community.name`: the community that owns the command. It can run elsewhere: in another community,
  or a DM.

Those are all the variables, with any counters the command has. Others (`user`, `author`, `args`,
`count`, `now`) print nothing, with no error, and so does a misspelt name. Names are already escaped for Markdown, and when someone posts as
a persona, `person.name` is the persona's name. To avoid notifying someone, use the name, not the
mention.

## Differences from standard Liquid

Tags allowed: `if`, `unless`, `case`, `assign`, `capture`, `echo`, `liquid`, `comment`, `#`, `raw`,
and `random`, which is new here. Anything else, such as `for`, `cycle`, `increment`, `include`,
`render` or `break`, is refused when saving.

Filters allowed: those under "Filters". Anything else, such as `map`, `where`, `sum`, `sample`,
`escape` or `json`, is refused when saving.

These fail silently or differ from what you may expect:

- **Empty text is true.** `{% if input %}` is always true. Use `{% if input != blank %}`, which is
  false for empty text and spaces. `{% if target %}` is fine, as `target` is nil when absent.
- **`<>` does not work:** it is always false. Use `!=`.
- **No brackets in conditions:** `{% if (a or b) and c %}` is refused. `and` and `or` run right to
  left, so nest `if`s when mixing them.
- `{% elsif %}` is the only spelling. `{% else if %}` and `{% elif %}` are refused.
- **No inline `if`:** `{{ "x" if false }}` still prints `x`. There is no `? :` either.
- **No list literals:** `{% assign a = ["x", "y"] %}` gives nothing. Use `split`.
- **Text never equals a number:** `{% if "1" == 1 %}` is false. `input` and `split` items are text;
  `(1..6) | one_of` gives numbers. Turn text into a number with `| plus: 0`, which gives 0 for
  anything not a number. Keep such numbers in range: `(1..0)` is an empty list, and `one_of` on an
  empty list prints nothing, so write `input | plus: 0 | at_least: 2 | at_most: 1000`.
- **`divided_by` keeps decimals:** `{{ 7 | divided_by: 2 }}` → `3.5`. Add `| floor` for whole
  numbers. `{{ 7 | divided_by: 0 }}` → `Infinity` and `{{ 7 | modulo: 0 }}` → `NaN`.
- **`reverse` is for lists:** `{{ "abc" | reverse }}` → `abc`, but
  `{{ "abc" | split: "" | reverse | join: "" }}` → `cba`.
- **`slice` with one number gives one item:** `{{ "hello" | slice: 1 }}` → `e`.
- **`split` keeps spaces:** `"a, b" | split: ","` gives `"a"` and `" b"`. Write lists with no spaces
  after the separator, as `"a,b"`, or split on `", "`.
- **"The mentioned person, or else whoever ran it":** write
  `{% if target %}{% assign who = target %}{% else %}{% assign who = person %}{% endif %}`, not
  `target | default: person`. For only the name, write
  `{% assign name = target.name | default: person.name %}`.
- **Only `person`, `target` and `channel` have `.name`.** Text, even text holding a mention, does not.
- **`==` and `contains` respect capitals.** Use `downcase` first. `==` on people compares mentions,
  so one account under two personas counts as two people.
- Do not `assign` to `person`, `input`, `target`, `channel` or `community`: it replaces them.

## Spacing

Line breaks in a script are kept, the result's start and end are trimmed, and a tag alone on a line
leaves an empty line behind. Between lines of a message, remove it with `-` next to the delimiters:
`{%- -%}` and `{{- -}}` eat the spaces and line breaks on that side.

```liquid
{{ person.name }} opens the box.
{%- if target %}
{{ target.name }} peeks in too.
{%- endif %}
It is empty.
```

`\n` inside a quoted string is a line break.

## Tags

`if`/`elsif`/`else`/`endif` and `unless`/`else`/`endunless` take `==`, `!=`, `>`, `<`, `>=`, `<=`,
`contains` (text or list), `and`, `or`, `blank`, `nil`, `true`, `false`.

```liquid
{% case input %}
{% when "a", "b" %}Either
{% else %}Neither
{% endcase %}
```

`assign` stores a value, `capture` stores what it prints, and `echo` prints inside `liquid`. Comments
are `{% # short %}` and `{% comment %}...{% endcomment %}`. `raw` prints Liquid as text.

```liquid
{% capture title %}{{ person.name }}'s day{% endcapture %}
{% liquid
  assign shout = title | upcase
  if shout contains "DAY"
    echo shout
  endif
%}
```

`random` picks one branch, with equal odds, and trims it. Use any number of branches. Branches can
hold any tags, even another `random`, and an `assign` inside one lasts after it. In `liquid`, the
lines are `random`, `or`, `endrandom`.

```liquid
{% random %}
{% assign drink = "tea" %}{% assign verb = "sips" %}
{% or %}
{% assign drink = "coffee" %}{% assign verb = "gulps" %}
{% endrandom %}
{{ person.name }} {{ verb }} some {{ drink }}.
```

## Filters

Filters run left to right. Lists come from `split` or a range such as `(1..6)`.

- **Random:** `{{ "a" | one_of: "b", "c" }}` is one of the three. `{{ (1..6) | one_of }}` and
  `{{ "a,b" | split: "," | one_of }}` are one item. Repeat items for odds: `"rain,rain,snow"`. Use
  another separator, such as `split: "|"`, for items with commas.
- **Words for numbers:** `{{ 1 | plural: "hug", "hugs" }}` → `hug`,
  `{{ 0 | plural: "hug", "hugs" }}` → `hugs`. `ordinal` is English, and prints the number too:
  `{{ 2 | ordinal }}` → `2nd`, `{{ 11 | ordinal }}` → `11th`.
- **Case:** `{{ "hi THERE" | capitalize }}` → `Hi there`, `{{ "a" | upcase }}` → `A`,
  `{{ "A" | downcase }}` → `a`.
- **Joining:** `{{ "b" | append: "c" }}` → `bc`, `{{ "b" | prepend: "a" }}` → `ab`.
- **Replacing:** `{{ "a-a" | replace: "a", "b" }}` → `b-b`, and `replace_first`, `replace_last`.
  `{{ "a-a" | remove: "a" }}` → `-`, and `remove_first`, `remove_last`.
- **Trimming:** `{{ " a " | strip }}` → `a`, and `lstrip`, `rstrip`, `strip_newlines`.
- **Shortening:** `{{ "one two three" | truncate: 8 }}` → `one t...`,
  `{{ "one two three" | truncate: 8, "…" }}` → `one two…`,
  `{{ "one two three" | truncatewords: 2 }}` → `one two...`.
- **Parts of text:** `{{ "hello" | slice: 1, 3 }}` → `ell`, `{{ "hello" | slice: -3, 3 }}` → `llo`,
  `{{ "hello" | size }}` → `5`, `{{ "hello" | first }}` → `h`, `{{ "hello" | last }}` → `o`.
- **Fallback:** `{{ nothing | default: "x" }}` → `x`, also for `""`, `false` and nil, not for spaces.
- **Links:** `{{ "cat & dog" | url_encode }}` → `cat+%26+dog`.
- **Numbers:** `{{ 2 | plus: 1 }}` → `3`, `{{ 3 | minus: 1 }}` → `2`, `{{ 3 | times: 2 }}` → `6`,
  `{{ 7 | divided_by: 2 | floor }}` → `3`, `{{ 7 | modulo: 3 }}` → `1`, `{{ -2 | abs }}` → `2`,
  `{{ 1.2 | ceil }}` → `2`, `{{ 3.14159 | round: 2 }}` → `3.14`, `{{ 5 | at_most: 3 }}` → `3`,
  `{{ 5 | at_least: 9 }}` → `9`.
- **Lists:** `{{ "b,a,b" | split: "," | size }}` → `3`,
  `{{ "b,a,b" | split: "," | sort | join: " " }}` → `a b b`,
  `{{ "b,a,b" | split: "," | uniq | join: " " }}` → `b a`, and `first`, `last`, `reverse`, `slice`,
  `compact` (drops nil), `concat: other_list`. Read items with `list[0]` and `list[-1]`, the count
  with `list.size`. `(1..n)` makes a list of numbers, up to about 100,000.

Useful with input: the first word is `{{ input | split: " " | first }}`, the rest is
`{{ input | split: " " | slice: 1, 999 | join: " " }}`, and the input without its first mention is
`{{ input | remove: target | strip }}`. Only the first person mentioned is `target`. A second mention
stays in that text, where it still prints as a mention, but its name cannot be read. There are no
loops, so to act on every item, use `join` or `replace`:
`{{ "a,b" | split: "," | join: ", and " }}` → `a, and b`, and `- {{ input | split: "," | join: "\n- " }}`
makes a bullet list.

## Dates

`{{ "now" | date: "%H:%M" }}` is in UTC. Add a time zone name for local time:
`{{ "now" | date: "%H:%M", "America/Los_Angeles" }}`. A wrong name makes the command fail.

`date` reads `"now"`, `"2026-12-25"`, `"Dec 25 2026"` and seconds since 1970. Text it cannot read
prints as it is. `{{ "2026-12-25" | date: "%A" }}` → `Friday`.

Codes: `%Y` 2026, `%y` 26, `%m` 03, `%B` March, `%b` Mar, `%d` 05, `%A` Thursday, `%a` Thu,
`%j` day of the year, `%H` 14, `%I` 02, `%M` 07, `%S` 09, `%p` PM, `%s` seconds since 1970, `%q`
ordinal suffix (th), `%Z` zone. `%-d` drops zeros. `%F`, `%T`, `%D`, `%R` and `%r` do not work and
print as they are, so write `%Y-%m-%d` and `%H:%M:%S`.

To show a time in each reader's own time zone, use a timestamp: `<t:{{ "now" | date: "%s" }}:R>`.

## Counters

A command can have up to 5 counters. They are not variables you create in the script: each is set up
in the command's Counters section, then read by its name, such as `{{ hugs }}`. Names use lowercase
letters, digits and `_`, start with a letter, and cannot be a variable's name.

- Every run adds one to each counter, and the script reads the count with this run added: the first
  run reads 1, so `{% if hugs == 1 %}` means the first time. The value is a number.
- A counter counts separately for any mix of: the person running it, the person mentioned, the
  channel. Choose none for one count for the whole command; the person running it and the person
  mentioned together count each pair.
- Counts are kept by account or persona, so changing a name changes nothing. Personas count
  separately unless that option is turned off.
- A counter kept per person mentioned needs a real mention: without one the command is refused and
  counts nothing, so the command's input cannot be None.
- A refused run counts nothing. Deleting a message does not lower a count.
- Two people running a command at the same instant can both read the same number; the stored count
  still goes up by two.

Input: Required. Counters: `hugs`, for the person mentioned.

```liquid
{% if hugs == 1 %}
{{ target.name }} just got their first hug!
{% else %}
{{ target.name }} has been hugged {{ hugs }} {{ hugs | plural: "time", "times" }}!
{% endif %}
```

## Message formatting

The result is a chat message, not HTML:

- `**bold**`, `*italic*`, `__underline__`, `~~strike~~`, `||spoiler||`, `` `code` ``, and fenced code.
- Lines starting with `# ` to `#### ` (headings), `-# ` (small text), `> ` (quote), `>>> ` (quote to
  the end), `- ` or `1. ` (lists). `> [!NOTE]` starts an alert: NOTE, TIP, IMPORTANT, WARNING or
  CAUTION.
- `[text](https://example.com)` for links.
- Timestamps: `<t:SECONDS:STYLE>`, where STYLE is `t` or `T` (time), `d` or `D` (date), `f` or `F`
  (both), `R` (relative).
- Emoji: Unicode directly, or `:smile:`. The editor turns a community's own `:name:` into its emoji
  on saving.
- Mentions act as if the member typed them: `@everyone` only works if they are allowed to use it.

## Limits and failures

The editor shows problems as you type, and its preview runs the script; **Run again** rerolls it.

- If a script prints nothing, or names a wrong time zone, whoever ran it only sees that it failed. An
  empty `random` branch can cause this.
- The message must fit the member's limit of 2,000 characters (4,000 for some accounts), or it is not
  sent. Shorten echoed input: `{{ input | truncate: 200 }}`.
- A run can allocate 100,000 characters and take 50 milliseconds.

## Examples

Input: Optional.

```liquid
{% if target == person %}
{{ person }} hugs themself. Aww.
{% elsif target %}
{{ person }} hugs {{ target }}!
{% elsif input != blank %}
{{ person }} hugs {{ input }}!
{% else %}
{{ person }} hugs everyone nearby!
{% endif %}
```

Input: Optional. Random text, with a fallback.

```liquid
{% assign who = input | default: "the nearest pillow" %}
{% random %}
{{ person }} gently tucks {{ who }} in to sleep!
{% or %}
{{ person }} wraps {{ who }} in a giant burrito blanket!
{% endrandom %}
```

Input: Optional. A number from the input, kept in range.

```liquid
{% assign sides = input | plus: 0 | at_least: 2 | at_most: 1000 %}
{% if input == blank %}{% assign sides = 20 %}{% endif %}
🎲 {{ person.name }} rolls a d{{ sides }}: **{{ (1..sides) | one_of }}**
```

Input: None. Rare results, and an answer that stays the same all day.

```liquid
{% assign roll = (1..100) | one_of %}
{% assign days = "Rainy,Sunny,Windy" | split: "," %}
{% assign today = "now" | date: "%j" | modulo: 3 %}
{{ days[today] }} day. {{ person.name }} finds
{%- if roll == 100 %} a legendary treasure!
{%- elsif roll > 80 %} a shiny coin.
{%- else %} a pebble.
{%- endif %}
```

Input: Required. Comparing a choice.

```liquid
{% assign me = input | downcase | strip %}
{% assign bot = "rock,paper,scissors" | split: "," | one_of %}
{% case me %}
{% when "rock", "paper", "scissors" %}
{{ person.name }}: {{ me }}. Bot: {{ bot }}.
{% if me == bot %}A draw!
{% elsif me == "rock" and bot == "scissors" %}You win!
{% elsif me == "paper" and bot == "rock" %}You win!
{% elsif me == "scissors" and bot == "paper" %}You win!
{% else %}Bot wins!
{% endif %}
{% else %}
Pick rock, paper or scissors.
{% endcase %}
```

Input: None. Days until a date.

```liquid
{% assign then = "2026-12-25" | date: "%s" %}
{% assign now = "now" | date: "%s" %}
{% assign days = then | minus: now | divided_by: 86400 | ceil %}
{{ days }} {{ days | plural: "day", "days" }} until the party!
```
