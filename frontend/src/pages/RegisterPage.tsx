
import SignUpForm from '../components/auth/SignUpForm';

export default function RegisterPage() {
  return (
    <div className="syn-auth-page syn-ui-kit">
      <div className="syn-auth-form">
        <SignUpForm />
      </div>
      <div className="syn-auth-aside syn-card syn-card--lavender">
        <div className="syn-auth-mark syn-auth-mark--dark" aria-hidden="true">S</div>
        <p className="syn-kicker">Pipeline integrity platform</p>
        <h1>Build a traceable inspection record.</h1>
        <p>Start with canonical data. Keep every method, assumption, and review decision attached.</p>
      </div>
    </div>
  );
}
