import { useTranslation } from "react-i18next";

export function WebImageImportErrorDialog({ onChooseLocal, onClose }: { onChooseLocal: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]" role="dialog" aria-modal="true" aria-labelledby="web-image-error-title">
      <div className="bg-white rounded-lg shadow-xl w-[420px] p-4">
        <h2 id="web-image-error-title" className="font-semibold text-sm mb-2">{t("import.webImage.title")}</h2>
        <p className="text-xs text-gray-600 leading-5 mb-4">
          {t("import.webImage.message")}
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100">{t("dialogs.close")}</button>
          <button onClick={onChooseLocal} className="px-3 py-1.5 text-xs rounded bg-blue-500 text-white hover:bg-blue-600">{t("import.webImage.chooseLocal")}</button>
        </div>
      </div>
    </div>
  );
}
