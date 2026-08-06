export default function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="flex items-center gap-3 text-2xl font-extrabold tracking-tight text-slate-800 dark:text-white">
          <span aria-hidden className="inline-block h-6 w-1.5 shrink-0 rounded-full bg-gradient-to-b from-brand-400 to-brand-600" />
          {title}
        </h1>
        {subtitle && <p className="mt-1 pl-[18px] text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
