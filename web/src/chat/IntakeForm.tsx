import { FormEvent, useState } from 'react';
import { ApiError, ChatApi, ChatOptions, ChatSession, OfferedCity, OfferedDepartment } from '../api/chatApi';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';

type FieldName = 'fullName' | 'phone' | 'cpf' | 'rg' | 'consent' | 'firstMessage';

const FIELD_ERRORS: Record<FieldName, string> = {
  fullName: 'Informe seu nome completo.',
  phone: 'Informe um telefone com DDD.',
  cpf: 'Informe um CPF válido.',
  rg: 'Informe o número do RG.',
  consent: 'Para continuar, é preciso concordar com o uso dos dados.',
  firstMessage: 'A mensagem é longa demais.',
};

interface IntakeFormProps {
  readonly api: ChatApi;
  readonly department: OfferedDepartment;
  readonly city: OfferedCity;
  readonly privacyNotice: ChatOptions['privacyNotice'];
  readonly onStarted: (session: ChatSession) => void;
  readonly onBack: () => void;
}

/** Quick checks for the customer's convenience; the server validates everything again. */
function localErrors(values: Record<'fullName' | 'phone' | 'cpf' | 'rg', string>, consent: boolean): FieldName[] {
  const errors: FieldName[] = [];
  if (values.fullName.trim().length < 3) errors.push('fullName');
  if (values.phone.replace(/\D/g, '').length < 10) errors.push('phone');
  if (values.cpf.replace(/\D/g, '').length !== 11) errors.push('cpf');
  if (values.rg.trim().length < 5) errors.push('rg');
  if (!consent) errors.push('consent');
  return errors;
}

export function IntakeForm({ api, department, city, privacyNotice, onStarted, onBack }: IntakeFormProps) {
  const [values, setValues] = useState({ fullName: '', phone: '', cpf: '', rg: '', firstMessage: '' });
  const [consent, setConsent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldName[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const setValue = (field: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [field]: value }));
  const errorOf = (field: FieldName) => (fieldErrors.includes(field) ? FIELD_ERRORS[field] : undefined);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const errors = localErrors(values, consent);
    setFieldErrors(errors);
    if (errors.length > 0) return;

    setSubmitting(true);
    try {
      const session = await api.startConversation({
        departmentCode: department.code,
        cityCode: city.code,
        ...values,
        consentVersion: privacyNotice.version,
      });
      onStarted(session);
    } catch (error) {
      setSubmitting(false);
      if (error instanceof ApiError && error.status === 400) {
        setFieldErrors(error.fields.filter((field): field is FieldName => field in FIELD_ERRORS));
        setFormError('Confira os campos destacados.');
      } else if (error instanceof ApiError && error.status === 422) {
        setFormError('Essa opção não está disponível no momento. Volte e escolha outra.');
      } else {
        setFormError('Não foi possível abrir o atendimento agora. Verifique sua conexão e tente de novo.');
      }
    }
  }

  return (
    <form className="step" onSubmit={submit} noValidate aria-labelledby="intake-title">
      <h2 id="intake-title">Seus dados</h2>
      <p className="step__summary">
        {department.name} · {city.name}
      </p>

      <TextField label="Nome completo" value={values.fullName} onChange={setValue('fullName')} error={errorOf('fullName')} autoComplete="name" maxLength={150} required />
      <TextField label="Telefone" value={values.phone} onChange={setValue('phone')} error={errorOf('phone')} hint="Com DDD, ex.: (15) 99999-0000" type="tel" inputMode="tel" autoComplete="tel-national" required />
      <TextField label="CPF" value={values.cpf} onChange={setValue('cpf')} error={errorOf('cpf')} inputMode="numeric" maxLength={14} required />
      <TextField label="RG" value={values.rg} onChange={setValue('rg')} error={errorOf('rg')} maxLength={20} required />

      <div className="field">
        <label htmlFor="first-message">Como podemos ajudar? (opcional)</label>
        <textarea id="first-message" value={values.firstMessage} onChange={(event) => setValue('firstMessage')(event.target.value)} rows={3} maxLength={2000} />
      </div>

      <div className="consent">
        <p className="consent__text">{privacyNotice.text}</p>
        <label className="consent__check">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            aria-invalid={errorOf('consent') ? true : undefined}
            aria-describedby={errorOf('consent') ? 'consent-error' : undefined}
          />
          Li e concordo com o uso dos meus dados para este atendimento.
        </label>
        {errorOf('consent') && (
          <span id="consent-error" className="field__error">
            {errorOf('consent')}
          </span>
        )}
      </div>

      {formError && <Alert tone="error">{formError}</Alert>}

      <div className="step__actions">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Abrindo atendimento…' : 'Iniciar atendimento'}
        </Button>
        <Button variant="link" onClick={onBack} disabled={submitting}>
          Voltar
        </Button>
      </div>
    </form>
  );
}
