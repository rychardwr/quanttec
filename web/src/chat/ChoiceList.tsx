import { Button } from '../ui/Button';

interface Choice {
  readonly code: string;
  readonly name: string;
}

interface ChoiceListProps {
  readonly title: string;
  readonly choices: readonly Choice[];
  readonly onChoose: (code: string) => void;
  readonly onBack?: () => void;
}

export function ChoiceList({ title, choices, onChoose, onBack }: ChoiceListProps) {
  return (
    <section className="step" aria-labelledby="step-title">
      <h2 id="step-title">{title}</h2>
      <ul className="choice-list">
        {choices.map((choice) => (
          <li key={choice.code}>
            <Button variant="secondary" className="choice-list__item" onClick={() => onChoose(choice.code)}>
              {choice.name}
            </Button>
          </li>
        ))}
      </ul>
      {onBack && (
        <Button variant="link" onClick={onBack}>
          Voltar
        </Button>
      )}
    </section>
  );
}
