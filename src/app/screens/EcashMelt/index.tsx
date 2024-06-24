import { CaretLeftIcon } from "@bitcoin-design/bitcoin-icons-react/filled";
import Button from "@components/Button";
import Container from "@components/Container";
import Header from "@components/Header";
import IconButton from "@components/IconButton";
import TextField from "@components/form/TextField";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import QrcodeAdornment from "~/app/components/QrcodeAdornment";
import toast from "~/app/components/Toast";
import {
  decodeCashuTokens,
  getMeltQuotes,
  validateCashuTokens,
} from "~/common/lib/ecash";

function EcashMelt() {
  const { t } = useTranslation("translation", { keyPrefix: "cashumelt" });
  const location = useLocation();
  const [cashuToken, setCashuToken] = useState(location.state?.decodedQR || "");
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);

    // TODO: Get melt summary/quote... without executing
    try {
      // TODO, try to decode both cashu & fedimint

      // Decode the token to ensure it's valid before attempting to melt
      // const decodedToken = getDecodedToken(cashuToken);
      const ecash = validateCashuTokens(cashuToken);
      if (!ecash) {
        toast.error(t("errors.invalid_cashu_token"));
        return;
      }
      const tokens = decodeCashuTokens(ecash);
      const quotes = await getMeltQuotes(tokens);
      if (!quotes) {
        toast.error(t("errors.invalid_cashu_token"));
        return;
      }

      navigate("/confirmMelt", {
        state: {
          args: {
            ecashMeltSummary: quotes,
          },
        },
      });
    } catch (error) {
      console.error(error);
      toast.error(t("errors.invalid_melt"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto no-scrollbar">
      <Header
        headerLeft={
          <IconButton
            onClick={() => navigate(-1)}
            icon={<CaretLeftIcon className="w-4 h-4" />}
          />
        }
      >
        {t("title")}
      </Header>
      <form onSubmit={handleSubmit} className="h-full">
        <Container justifyBetween maxWidth="sm">
          <div className="pt-4">
            <TextField
              id="cashuToken"
              label={t("input.label")}
              value={cashuToken}
              placeholder={t("input.placeholder")}
              disabled={loading}
              autoFocus
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setCashuToken(event.target.value.trim())
              }
              endAdornment={<QrcodeAdornment route="cashuRedeem" />}
            />
          </div>
          <div className="mt-4">
            <Button
              type="submit"
              label={t("actions.melt")}
              primary
              fullWidth
              loading={loading}
              disabled={cashuToken === "" || loading}
            />
          </div>
        </Container>
      </form>
    </div>
  );
}

export default EcashMelt;
