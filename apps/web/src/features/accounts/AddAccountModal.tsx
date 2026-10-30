import { Alert } from "../../components/ui/alert";
import { Dialog } from "../../components/ui/dialog";
import { SegmentedControl } from "../../components/ui/segmented-control";
import { interpolate, useI18n } from "../../i18n";
import { hubCopy } from "./detail/hubCopy";
import { CredentialsLoginForm } from "./CredentialsLoginForm";
import { LoginProgress } from "./LoginProgress";
import { QrLoginPanel } from "./QrLoginPanel";
import { useAddAccountFlow, type LoginMode } from "./useAddAccountFlow";

export function AddAccountModal({
  onClose,
  onDone,
  initialMode,
  reloginAccountName,
}: {
  onClose: () => void;
  onDone: () => Promise<void>;
  initialMode?: LoginMode | undefined;
  /** Set when an existing account renews its Steam login. */
  reloginAccountName?: string | undefined;
}) {
  const { locale, messages: t } = useI18n();
  const copy = hubCopy(locale);
  const flow = useAddAccountFlow({
    onClose,
    onDone,
    initialMode,
    initialAccountName: reloginAccountName,
  });

  return (
    <Dialog
      title={
        reloginAccountName
          ? interpolate(copy.reloginTitle, { name: reloginAccountName })
          : t.addAccount.title
      }
      description={
        reloginAccountName ? copy.reloginDescription : t.addAccount.description
      }
      onClose={onClose}
    >
      <div className="grid gap-4">
        <SegmentedControl
          value={flow.mode}
          onChange={flow.switchMode}
          ariaLabel={t.addAccount.loginMode}
          className="w-full grid-cols-2"
          options={[
            { label: t.addAccount.qrLogin, value: "qr" },
            { label: t.addAccount.fallback, value: "credentials" },
          ]}
        />

        <LoginProgress step={flow.loginStep} />

        {flow.mode === "qr" ? (
          <QrLoginPanel
            started={Boolean(flow.qr)}
            dataUrl={flow.qrDataUrl}
            loading={flow.qrLoading}
            onStart={() => void flow.startQr()}
          />
        ) : (
          <CredentialsLoginForm
            credentials={flow.credentials}
            loading={flow.credentialsLoading}
            onChange={flow.updateCredential}
            onSubmit={flow.submitCredentials}
          />
        )}

        {flow.message && <Alert tone="success">{flow.message}</Alert>}
        {flow.error && <Alert tone="danger">{flow.error}</Alert>}
      </div>
    </Dialog>
  );
}
