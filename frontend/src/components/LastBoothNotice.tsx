import { Modal } from './Modal';

export const LAST_BOOTH_TITLE = 'अंतिम बूथ — सूचना';
export const LAST_BOOTH_TEXT =
  'यह इस वार्ड का अंतिम बूथ है। विवरण दर्ज करने से पहले कृपया सुनिश्चित करें कि डाक मतपत्रों की परिणाम पर्ची आपको प्राप्त हो चुकी है।';

/** Information only: "ठीक है" (or Esc) closes it and the entry form works as usual. */
export function LastBoothNotice({ onClose }: { onClose: () => void }) {
  return (
    <Modal label={LAST_BOOTH_TITLE} onCancel={onClose}>
      <h2>{LAST_BOOTH_TITLE}</h2>
      <p className="big-explain">{LAST_BOOTH_TEXT}</p>
      <div className="actions">
        <button type="button" className="btn btn-primary btn-big" onClick={onClose}>
          ठीक है
        </button>
      </div>
    </Modal>
  );
}
