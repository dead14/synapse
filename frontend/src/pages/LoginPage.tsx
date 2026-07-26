
import SignInForm from '../components/auth/SignInForm';

export default function LoginPage() {
  return (
    <div className="syn-auth-page syn-ui-kit">
      <div className="syn-auth-form">
        <SignInForm />
      </div>
      <div className="syn-auth-aside syn-card syn-card--ink">
        <div className="syn-auth-mark" aria-hidden="true">S</div>
        <p className="syn-kicker">Pipeline integrity platform</p>
        <h1>Inspection evidence, kept accountable.</h1>
        <p>Access the engineering workspace for runs, alignment, assessment, and audit history.</p>
      </div>
    </div>
  );
}
