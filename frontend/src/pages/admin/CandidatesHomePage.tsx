import { Link } from 'react-router-dom';
import { PageIntro } from '../../components/AdminParts';
import '../../styles/admin.css';

/** DM "उम्मीदवार सूची": two tasks, one card each. */
export function CandidatesHomePage() {
  return (
    <>
      <PageIntro title="उम्मीदवार सूची" hint="पहले Excel से सूची अपलोड करें, फिर सूची जाँचें और लॉक करें।" />
      <div className="cards">
        <section className="task-card">
          <h2>1. Excel से सूची अपलोड करें</h2>
          <p>सभी पंचायत समितियों और ज़िला परिषद के वार्डों की सूची एक साथ।</p>
          <Link className="btn btn-primary btn-big" to="/admin/candidates/upload">
            अपलोड पर जाएँ
          </Link>
        </section>
        <section className="task-card">
          <h2>2. सूची जाँचें और लॉक करें</h2>
          <p>रिपोर्ट प्रिंट करें, गलत सूची RO को वापस भेजें, फिर लॉक करें।</p>
          <Link className="btn btn-primary btn-big" to="/admin/candidates/check">
            जाँच पर जाएँ
          </Link>
        </section>
      </div>
    </>
  );
}
