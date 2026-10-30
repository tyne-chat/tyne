// SPDX-License-Identifier: AGPL-3.0-or-later

import styles from '@app/features/guild_commands/components/GuildCommandScriptReference.module.css';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';

// Fork: a short reference beside the script editor, in the app because the fork's documentation site
// is not public. The code stays in English: it is the script language itself. The whole language is
// in `docs/server-command-scripts.md`, which it links to.

const GUIDE_URL = 'https://github.com/tyne-chat/tyne/blob/tyne/docs/server-command-scripts.md';

const TITLE = msg({
	message: 'Script reference',
	comment: 'Title of the expandable help under the command script editor.',
});

const GUIDE = msg({
	message: 'Full script guide',
	comment: 'Link at the end of the command script help to the complete guide on GitHub.',
});

const VARIABLES = [
	{
		code: '{{ person }}',
		label: msg({message: 'The person running it, as a mention', comment: 'Help for a command script variable.'}),
	},
	{code: '{{ person.name }}', label: msg({message: 'Their name', comment: 'Help for a command script variable.'})},
	{code: '{{ input }}', label: msg({message: 'What they type', comment: 'Help for a command script variable.'})},
	{
		code: '{{ target }}',
		label: msg({
			message: 'The first person they mention, if any',
			comment: 'Help for a command script variable.',
		}),
	},
	{
		code: '{{ target.name }}',
		label: msg({message: 'That person’s name', comment: 'Help for a command script variable.'}),
	},
	{
		code: '{{ channel }}',
		label: msg({message: 'The channel, as a mention', comment: 'Help for a command script variable.'}),
	},
	{
		code: '{{ community.name }}',
		label: msg({message: 'The name of this community', comment: 'Help for a command script variable.'}),
	},
] as const;

const EXAMPLES = [
	{
		code: '{% random %}\nFirst option\n{% or %}\nSecond option\n{% endrandom %}',
		label: msg({message: 'Pick one option at random', comment: 'Help for an example in a command script.'}),
	},
	{
		code: '{% if target %}\n{{ person }} hugs {{ target }}\n{% else %}\n{{ person }} hugs the air\n{% endif %}',
		label: msg({
			message: 'Change the message depending on what they typed',
			comment: 'Help for an example in a command script.',
		}),
	},
	{
		code: '{{ "warm" | one_of: "gentle", "big" }}',
		label: msg({message: 'Pick one word at random', comment: 'Help for an example in a command script.'}),
	},
	{
		code: '{{ count | plural: "time", "times" }}',
		label: msg({message: 'Pick the word for a number', comment: 'Help for an example in a command script.'}),
	},
	{
		code: '{{ count | ordinal }}',
		label: msg({
			message: 'Write a number as 1st, 2nd, 3rd',
			comment: 'Help for an example in a command script. Translators: keep the English examples 1st, 2nd, 3rd.',
		}),
	},
] as const;

export function GuildCommandScriptReference() {
	const {i18n} = useLingui();
	return (
		<details className={styles.reference} data-flx="guild-commands.guild-command-script-reference.reference">
			<summary className={styles.title} data-flx="guild-commands.guild-command-script-reference.title">
				{i18n._(TITLE)}
			</summary>
			<dl className={styles.list} data-flx="guild-commands.guild-command-script-reference.variables">
				{VARIABLES.map(({code, label}) => (
					<div key={code} className={styles.row} data-flx="guild-commands.guild-command-script-reference.variable">
						<dt data-flx="guild-commands.guild-command-script-reference.term">
							<code className={styles.code} data-flx="guild-commands.guild-command-script-reference.code">
								{code}
							</code>
						</dt>
						<dd className={styles.label} data-flx="guild-commands.guild-command-script-reference.label">
							{i18n._(label)}
						</dd>
					</div>
				))}
			</dl>
			{EXAMPLES.map(({code, label}) => (
				<div key={code} className={styles.example} data-flx="guild-commands.guild-command-script-reference.example">
					<div className={styles.label} data-flx="guild-commands.guild-command-script-reference.example-label">
						{i18n._(label)}
					</div>
					<pre className={styles.block} data-flx="guild-commands.guild-command-script-reference.example-code">
						{code}
					</pre>
				</div>
			))}
			<a
				className={styles.guide}
				href={GUIDE_URL}
				target="_blank"
				rel="noreferrer"
				data-flx="guild-commands.guild-command-script-reference.guide"
			>
				{i18n._(GUIDE)}
			</a>
		</details>
	);
}
