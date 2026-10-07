import { Link } from 'react-router-dom';

export function NotAllowedPage() {
  return (
    <>
      <h1>अनुमति नहीं</h1>
      <p className="msg msg-error">✗ यह पेज आपके लिए नहीं है, या यह वार्ड/एंट्री मौजूद नहीं है।</p>
      <Link className="btn btn-primary" to="/">
        मुख्य पेज पर जाएँ
      </Link>
    </>
  );
}

export function NotFoundPage() {
  return (
    <main className="page">
      <h1>पेज नहीं मिला</h1>
      <Link className="btn btn-primary" to="/">
        मुख्य पेज पर जाएँ
      </Link>
    </main>
  );
}
