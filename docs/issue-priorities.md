# Issue priorities

What the `priority:*` labels on [tyne-chat/tyne](https://github.com/tyne-chat/tyne/issues) mean. The
scheme was read off a triage pass of 2026-11-21, which reviewed 37 issues and changed 24 of them,
and then applied to the rest of the board (tyne-chat/tyne#884). Change this file when the way issues
are ranked changes.

## What a priority measures

How much the issue changes what people live with when they use Tyne day to day. It does not measure
how broken the code is. So a bug with a workaround in something people do all day can outrank a bug
with no workaround in something rarely used, a feature can be P1, and a reporter's own request can
go down as well as up (triage lowered four issues their reporters had marked P1).

Weigh two things:

- **How often people meet it.** Daily: sending and reading messages, personas and their tags,
  emoji, GIFs and stickers, reactions, signals, threads, notifications, viewing media. Now and
  then: importing, settings and profile editing, desktop updates, extra desktop windows. Rarely:
  unusual window sizes or zoom, a failed request, a race, an old build.
- **What it costs when they do.** Content or an identity lost or wrong; something they cannot do;
  friction every time; a cosmetic flaw.

## Levels

**P0: outage, data loss, or a security or privacy problem.** Vulnerabilities are never filed here
(see `.github/SECURITY.md`).

**P1: matters every day, or is what makes Tyne worth using.**

- Bugs in a daily flow, even with a workaround: a message vanishing from a live conversation
  (#701), a GIF dropped when switching persona by tag (#816), custom emoji loading slowly after
  every app update (#768), signals that cannot be switched or stop updating on phones (#743, #729).
- Features at the centre of personas and self-expression that people ask for: complete persona
  profiles (#108), groups (#829), a picture gallery (#228, #825), custom emoji in names and bios
  (#128), the full composer in bios (#864), role colours from a user's accent (#226).
- What a community needs to move from Discord, and Discord habits people meet constantly:
  importing history (#608, #699), a starboard replacement (#703), bold across lines (#641),
  recently added emoji first (#244), personal and instance emoji packs (#810).
- Persona import on its main path: pictures imported (#261), a review people can follow (#754).

**P2: a real difference, but met less often or easy to get around.**

- Ergonomics for large systems: reacting as several personas (#86), compact persona lists (#225,
  #806), keeping one's place in the Personas page (#762, #852).
- Keyboard access where the mouse works (#112).
- Layouts that break at narrow widths or high zoom on common screens (#232).
- Desktop window and update annoyances that have a workaround (#234, #507, #544).
- Emoji beyond the basics: sequenced emoji (#651), categories (#815).
- Request floods over the global rate limit, found in the code but not yet seen (#310, #503).

**P3: nice to have, rare or cosmetic.**

- Uncommon setups: a narrow window with the channel list collapsed (#472), wide phone layouts
  (#439).
- Other importers and partial imports (#56, #243, #550).
- Conveniences few people asked for: full-size avatar on click (#57), more zoom when cropping
  (#229), a preview before sending on Android (#214).
- Design questions not decided yet (#207).
- Replacing bot features nobody uses daily: welcome banners, levels (#246).
- Problems found by reading the code that need a failed request, a race or an old build to show.

## Rules of thumb

- **Found only in the code.** Rank it by what it would do in normal use, and no higher than P2
  until someone has seen it happen. Most such findings are P3.
- **Polish on a P1 feature is not P1.** The import review is P1 (#754); its wording, centring and
  result screen are P3 (#747 to #761).
- **The issue form's priority is the reporter's first guess.** Triage moves it in either direction.
- **Done upstream:** close the issue and say where upstream did it.
- **Reports that need a repro** keep the rank of what was reported (#767, #776).

## Tasks

`task` issues (tooling, the nightly rebase, docs, refactors, audit follow-ups) were not part of the
triage pass. For them the levels mean:

- **P0:** production or the nightly pipeline is down, or secrets are exposed.
- **P1:** blocks a release, a deploy or the nightly rebase, or a P1 issue waits on it.
- **P2:** saves recurring work (rebase conflicts, manual release steps) or lowers the risk in a
  P1 area.
- **P3:** tidy-ups, placement fixes, problems that may never happen.
