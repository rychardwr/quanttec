import { useCallback, useEffect, useState } from 'react';
import { ChatApi, ChatOptions, ChatSession, OfferedCity, OfferedDepartment } from '../api/chatApi';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { ChoiceList } from './ChoiceList';
import { IntakeForm } from './IntakeForm';

type Step =
  | { readonly kind: 'department' }
  | { readonly kind: 'city'; readonly department: OfferedDepartment }
  | { readonly kind: 'form'; readonly department: OfferedDepartment; readonly city: OfferedCity };

type OptionsState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly options: ChatOptions };

interface NewConversationProps {
  readonly api: ChatApi;
  readonly onStarted: (session: ChatSession) => void;
}

export function NewConversation({ api, onStarted }: NewConversationProps) {
  const [optionsState, setOptionsState] = useState<OptionsState>({ kind: 'loading' });
  const [step, setStep] = useState<Step>({ kind: 'department' });

  const loadOptions = useCallback(() => {
    setOptionsState({ kind: 'loading' });
    api.getOptions().then(
      (options) => setOptionsState({ kind: 'ready', options }),
      () => setOptionsState({ kind: 'error' }),
    );
  }, [api]);

  useEffect(loadOptions, [loadOptions]);

  if (optionsState.kind === 'loading') {
    return <Spinner label="Carregando…" />;
  }
  if (optionsState.kind === 'error') {
    return (
      <div className="step">
        <Alert tone="error">Não foi possível carregar o atendimento. Verifique sua conexão.</Alert>
        <Button onClick={loadOptions}>Tentar de novo</Button>
      </div>
    );
  }

  const { departments, privacyNotice } = optionsState.options;
  if (departments.length === 0) {
    return <Alert tone="info">No momento, não há atendimentos disponíveis por este canal.</Alert>;
  }

  switch (step.kind) {
    case 'department':
      return (
        <ChoiceList
          title="Com qual área você quer falar?"
          choices={departments}
          onChoose={(code) => setStep({ kind: 'city', department: departments.find((d) => d.code === code)! })}
        />
      );
    case 'city':
      return (
        <ChoiceList
          title="Em qual cidade você está?"
          choices={step.department.cities}
          onChoose={(code) =>
            setStep({ kind: 'form', department: step.department, city: step.department.cities.find((c) => c.code === code)! })
          }
          onBack={() => setStep({ kind: 'department' })}
        />
      );
    case 'form':
      return (
        <IntakeForm
          api={api}
          department={step.department}
          city={step.city}
          privacyNotice={privacyNotice}
          onStarted={onStarted}
          onBack={() => setStep({ kind: 'city', department: step.department })}
        />
      );
  }
}
