import { AlertCircle, Monitor, Tablet } from 'lucide-react';
import { BlendcraftLogoSVG } from '../ui/BlendcraftLogoSVG';
import BlendcraftIcon from 'figma:asset/987cf5f33064a7023b59cef30c3e7f415b485d24.png';

/** Phone-only gate. Intentionally static so phones never initialize the studio renderer or export runtime. */
export function MobileBlockPage() {
  return (
    <main className="fixed inset-0 overflow-y-auto bg-zinc-950 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_15%,rgba(6,182,212,0.22),transparent_38%),radial-gradient(circle_at_80%_75%,rgba(79,70,229,0.24),transparent_42%)]" />
      <div className="relative z-10 flex min-h-full items-center justify-center p-6">
        <section className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950/80 p-7 text-center shadow-2xl backdrop-blur-xl">
          <img src={BlendcraftIcon} alt="Blendcraft Studio" className="mx-auto mb-5 h-16 w-16" />
          <BlendcraftLogoSVG className="mx-auto mb-8 h-5 w-auto" />
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-amber-400/30 bg-amber-400/10">
            <AlertCircle className="h-7 w-7 text-amber-300" />
          </div>
          <h1 className="text-2xl font-semibold">Open BLENDCRAFT on a larger screen</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-300">
            BLENDCRAFT Studio is a professional GPU design tool built for desktop, laptop, iPad, and landscape tablets. Mobile phones are not supported yet.
          </p>
          <div className="mt-7 grid grid-cols-2 gap-3 text-left">
            <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4">
              <Monitor className="mb-3 h-5 w-5 text-cyan-300" />
              <p className="text-sm font-medium">Desktop or laptop</p>
            </div>
            <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4">
              <Tablet className="mb-3 h-5 w-5 text-cyan-300" />
              <p className="text-sm font-medium">iPad or tablet</p>
            </div>
          </div>
          <p className="mt-6 text-xs text-zinc-500">Phone support is planned for a future mobile-specific experience.</p>
        </section>
      </div>
    </main>
  );
}
