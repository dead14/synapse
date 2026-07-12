
import SignUpForm from '../components/auth/SignUpForm';

export default function RegisterPage() {
  return (
    <div className="relative flex w-full h-screen overflow-hidden bg-white z-1 dark:bg-gray-900 sm:p-5 sm:pt-0">
      <div className="flex flex-col flex-1 w-full overflow-y-auto lg:w-1/2 no-scrollbar items-center justify-center">
        <SignUpForm />
      </div>
      
      {/* Right side background image/branding */}
      <div className="hidden lg:flex lg:w-1/2 items-center justify-center rounded-2xl m-4 relative overflow-hidden shadow-2xl">
        <div className="absolute inset-0 bg-[url('/Pipeline.avif')] bg-cover bg-center"></div>
        <div className="absolute inset-0 bg-white/40 backdrop-blur-md"></div>
        <div className="relative z-10 flex flex-col items-center p-10 text-center">
          <img src="/logo.png" alt="Synapse Logo" className="w-48 h-48 mb-6 object-contain drop-shadow-sm scale-125" />
          <h2 className="text-6xl font-black text-gray-900 mb-2 tracking-tighter uppercase">Synapse</h2>
          <p className="text-gray-800 max-w-sm text-lg font-medium">
            Flawless Matching, Seamless Processing.
          </p>
        </div>
      </div>
    </div>
  );
}
