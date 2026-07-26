import { useRef, useState } from 'react';
import { FiCheck, FiChevronRight, FiExternalLink, FiFileText, FiUploadCloud } from 'react-icons/fi';

type SubmissionStep = {
  label: string;
  state: 'complete' | 'current' | 'upcoming';
};

const steps: SubmissionStep[] = [
  { label: 'Manage team', state: 'complete' },
  { label: 'Project overview', state: 'complete' },
  { label: 'Project details', state: 'complete' },
  { label: 'Additional info', state: 'current' },
  { label: 'Submit', state: 'upcoming' },
];

export default function SubmissionAdditionalInfoPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);

  const handleFile = (file?: File) => {
    if (file) setFileName(file.name);
  };

  return (
    <main className="submission-page">
      <div className="submission-shell">
        <header className="submission-header">
          <div className="submission-title-row">
            <a className="submission-brand" href="/" aria-label="Return to Synapse dashboard">
              Synapse - Pipeline Assessment
            </a>
            <span className="submission-badge">DRAFT</span>
            <span className="submission-progress">3/5 steps done</span>
          </div>
          <div className="submission-header-actions">
            <span className="submission-deadline">5 days to deadline</span>
            <button type="button" className="submission-preview-button" onClick={() => setPreviewOpen((open) => !open)}>
              Preview <FiExternalLink aria-hidden="true" />
            </button>
          </div>
        </header>

        <nav className="submission-stepper" aria-label="Submission progress">
          {steps.map((step, index) => (
            <button
              key={step.label}
              type="button"
              className={`submission-step submission-step--${step.state}`}
              aria-current={step.state === 'current' ? 'step' : undefined}
            >
              <span className="submission-step__marker" aria-hidden="true">
                {step.state === 'complete' ? <FiCheck /> : <span />}
              </span>
              <span>{step.label}</span>
              {index < steps.length - 1 && <FiChevronRight className="submission-step__chevron" aria-hidden="true" />}
            </button>
          ))}
        </nav>

        <section className="submission-content" aria-labelledby="submission-heading">
          <div className="submission-heading-row">
            <h1 id="submission-heading">Additional info</h1>
            <span className="submission-audience">For judges and organizers</span>
          </div>
          <p className="submission-intro">
            Unless noted, additional info is for judges and hackathon organizers and will not appear on your public project page.
          </p>

          <div className="submission-rule" />

          <section className="submission-upload" aria-labelledby="upload-heading">
            <h2 id="upload-heading">Upload a File</h2>
            <p><em>Upload a file as part of your submission - e.g., zip, pdf, word, apk, etc. To upload multiple files, put them in a zip file and upload the zip file. Limit: 35 MB.</em></p>
            <input
              ref={inputRef}
              id="submission-file"
              className="submission-file-input"
              type="file"
              accept=".zip,.pdf,.doc,.docx,.apk"
              onChange={(event) => handleFile(event.target.files?.[0])}
            />
            <label className="submission-dropzone" htmlFor="submission-file">
              <FiUploadCloud aria-hidden="true" />
              <span>{fileName || 'Choose a file'}</span>
              <small>{fileName ? 'Selected for submission' : 'ZIP, PDF, DOC, DOCX, or APK · 35 MB max'}</small>
            </label>
            {fileName && (
              <div className="submission-file-row" role="status">
                <FiFileText aria-hidden="true" />
                <span>{fileName}</span>
                <button type="button" onClick={() => { setFileName(''); if (inputRef.current) inputRef.current.value = ''; }}>
                  Remove
                </button>
              </div>
            )}
          </section>

          {previewOpen && (
            <aside className="submission-preview" role="status">
              <strong>Preview mode</strong>
              <span>This private information is visible only to judges and organizers.</span>
            </aside>
          )}
        </section>
      </div>
    </main>
  );
}
