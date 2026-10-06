import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function DmPlaceholderPage() {
  const { user } = useAuth();
  return (
    <>
      <h1>नमस्ते{user?.fullName ? `, ${user.fullName}` : ''}</h1>
      <p className="big">जिला निर्वाचन अधिकारी की रिपोर्ट भाग 10 में आएँगी।</p>
      <p>इस डैशबोर्ड पर अभी आपके लिए कोई काम नहीं है।</p>
    </>
  );
}

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
