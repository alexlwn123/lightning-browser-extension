import Button from "@components/Button";
import ConfirmOrCancel from "@components/ConfirmOrCancel";
import Container from "@components/Container";
import PaymentSummary from "@components/PaymentSummary";
import PublisherCard from "@components/PublisherCard";
import ResultCard from "@components/ResultCard";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import ScreenHeader from "~/app/components/ScreenHeader";
import toast from "~/app/components/Toast";
import { useAccount } from "~/app/context/AccountContext";
import { useSettings } from "~/app/context/SettingsContext";
import { useNavigationState } from "~/app/hooks/useNavigationState";
import { USER_REJECTED_ERROR } from "~/common/constants";
import { executeMelts, MeltSummary } from "~/common/lib/ecash";
import msg from "~/common/lib/msg";

function ConfirmMelt() {
  const {
    isLoading: isLoadingSettings,
    settings,
    getFormattedFiat,
    getFormattedSats,
  } = useSettings();

  const showFiat = !isLoadingSettings && settings.showFiat;

  const { t } = useTranslation("translation", {
    keyPrefix: "confirm_payment",
  });
  const { t: tCommon } = useTranslation("common");

  const navState = useNavigationState();

  const meltSummary = navState.args?.ecashMeltSummary as MeltSummary;
  // 1. decode it...
  // 2. get invoices (melt quotes)
  // 3. present aggregate melt quote (melt summary) to user
  // 4. upon confirming, pay invoices to self
  // const invoice = lightningPayReq.decode(ecash);

  const navigate = useNavigate();
  const auth = useAccount();

  const [fiatAmount, setFiatAmount] = useState("");
  const [formattedAmountSats, setFormattedAmountSats] = useState("");

  useEffect(() => {
    (async () => {
      const sats = getFormattedSats(meltSummary.totalAmount);
      const fiat = await getFormattedFiat(meltSummary.totalAmount);
      setFormattedAmountSats(sats);
      if (showFiat) setFiatAmount(fiat);
    })();
  }, [getFormattedFiat, getFormattedSats, meltSummary.totalAmount, showFiat]);

  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  async function confirm() {
    if (!meltSummary) return;
    try {
      setLoading(true);
      const response = await executeMelts(meltSummary);

      auth.fetchAccountInfo(); // Update balance.
      msg.reply(response);

      setSuccessMessage(
        t("success", {
          amount: `${formattedAmountSats} ${
            showFiat ? ` (${fiatAmount})` : ``
          }`,
        })
      );
    } catch (e) {
      console.error(e);
      if (e instanceof Error) toast.error(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  function reject(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (navState.isPrompt) {
      msg.error(USER_REJECTED_ERROR);
    } else {
      navigate(-1);
    }
  }

  function close(e: React.MouseEvent<HTMLButtonElement>) {
    if (navState.isPrompt) {
      window.close();
    } else {
      e.preventDefault();
      navigate(-1);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    confirm();
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto no-scrollbar">
      <ScreenHeader title={!successMessage ? t("title") : tCommon("success")} />
      {!successMessage ? (
        <form onSubmit={handleSubmit} className="grow flex">
          <Container justifyBetween maxWidth="sm">
            <div>
              {navState.origin && (
                <PublisherCard
                  title={navState.origin.name}
                  image={navState.origin.icon}
                  url={navState.origin.host}
                />
              )}
              <div className="my-4">
                <div className="mb-4 p-4 shadow bg-white dark:bg-surface-02dp rounded-lg">
                  <PaymentSummary
                    amount={meltSummary.totalAmount}
                    fiatAmount={fiatAmount}
                    description={"Melt ecash into lightning"}
                  />
                </div>
              </div>
            </div>
            <div>
              <ConfirmOrCancel
                disabled={loading}
                loading={loading}
                onCancel={reject}
                label={t("actions.pay_now")}
              />
            </div>
          </Container>
        </form>
      ) : (
        <div className="grow">
          <Container justifyBetween maxWidth="sm">
            <ResultCard
              isSuccess
              message={
                !navState.origin
                  ? successMessage
                  : tCommon("success_message", {
                      amount: formattedAmountSats,
                      fiatAmount: showFiat ? ` (${fiatAmount})` : ``,
                      destination: navState.origin.name,
                    })
              }
            />
            <div className="mt-4">
              <Button
                onClick={close}
                label={tCommon("actions.close")}
                fullWidth
              />
            </div>
          </Container>
        </div>
      )}
    </div>
  );
}

export default ConfirmMelt;
