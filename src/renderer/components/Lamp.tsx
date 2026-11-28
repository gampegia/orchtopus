import type { SessionStateWord } from '../../shared/api-types';
import { STATE_LABEL, STATE_SIGNAL, isRingLamp } from '../../shared/state-words';

/** The state dot. Never alone: always render a word right after it. */
export function Lamp({ word }: { word: SessionStateWord }): React.JSX.Element {
  return (
    <span
      className={isRingLamp(word) ? 'lamp ring' : 'lamp'}
      data-lamp={word}
      data-signal={STATE_SIGNAL[word]}
      aria-hidden="true"
    />
  );
}

/** A lamp with its state word, in the word's signal colour. */
export function StateWord({ word }: { word: SessionStateWord }): React.JSX.Element {
  return (
    <span className="state-word" data-signal={STATE_SIGNAL[word]}>
      <Lamp word={word} />
      <span>{STATE_LABEL[word]}</span>
    </span>
  );
}
