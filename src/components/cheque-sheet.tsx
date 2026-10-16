import { fieldValue, type ChequeField, type ChequePrintData } from '@/modules/treasury/cheque-print';

export type SheetLayout = {
  widthMm: number;
  heightMm: number;
  offsetXMm: number;
  offsetYMm: number;
  fields: ChequeField[];
};

/**
 * برگهٔ چک با مقیاس ۱:۱ (میلی‌متر).
 * مبدأ مختصات: گوشهٔ بالا-راست برگه. xMm فاصله از لبهٔ راست و yMm فاصله از لبهٔ بالا.
 */
export function ChequeSheet({
  layout,
  data,
  grid = false,
  outline = false,
  highlightKey,
  onPick,
  className,
}: {
  layout: SheetLayout;
  data: ChequePrintData;
  grid?: boolean;
  outline?: boolean;
  highlightKey?: string | null;
  onPick?: (xMm: number, yMm: number) => void;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: `${layout.widthMm}mm`,
        height: `${layout.heightMm}mm`,
        overflow: 'hidden',
        background: '#fff',
        border: outline ? '1px dashed #94a3b8' : 'none',
        boxSizing: 'border-box',
      }}
      onClick={
        onPick
          ? (e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const pxPerMm = r.width / layout.widthMm;
              const xMm = (r.right - e.clientX) / pxPerMm;
              const yMm = (e.clientY - r.top) / pxPerMm;
              onPick(Math.round(xMm * 10) / 10, Math.round(yMm * 10) / 10);
            }
          : undefined
      }
    >
      {grid && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'repeating-linear-gradient(to left, rgba(37,99,235,.35) 0 0.2mm, transparent 0.2mm 10mm),' +
              'repeating-linear-gradient(to bottom, rgba(37,99,235,.35) 0 0.2mm, transparent 0.2mm 10mm),' +
              'repeating-linear-gradient(to left, rgba(148,163,184,.3) 0 0.1mm, transparent 0.1mm 5mm),' +
              'repeating-linear-gradient(to bottom, rgba(148,163,184,.3) 0 0.1mm, transparent 0.1mm 5mm)',
          }}
        />
      )}
      <div style={{ position: 'absolute', inset: 0, transform: `translate(${-layout.offsetXMm}mm, ${layout.offsetYMm}mm)` }}>
        {layout.fields
          .filter((f) => f.enabled)
          .map((f) => {
            const value = fieldValue(f.key, data);
            if (!value) return null;
            const align = f.align ?? 'right';
            return (
              <span
                key={f.key}
                style={{
                  position: 'absolute',
                  top: `${f.yMm}mm`,
                  right: `${f.xMm}mm`,
                  transform: align === 'center' ? 'translateX(50%)' : align === 'left' ? 'translateX(100%)' : undefined,
                  fontSize: `${f.fontSize}pt`,
                  fontWeight: f.bold ? 700 : 400,
                  letterSpacing: f.charSpacingMm ? `${f.charSpacingMm}mm` : undefined,
                  // عرض ثابت (نه max-width) چون جعبهٔ absolute وگرنه به فضای باقی‌مانده تا لبه محدود می‌شود
                  width: f.maxWidthMm ? `${f.maxWidthMm}mm` : 'max-content',
                  whiteSpace: f.maxWidthMm ? 'normal' : 'nowrap',
                  lineHeight: 1.35,
                  textAlign: align,
                  direction: 'rtl',
                  color: '#000',
                  outline: highlightKey === f.key ? '1px solid #2563eb' : undefined,
                  background: highlightKey === f.key ? 'rgba(37,99,235,.08)' : undefined,
                }}
              >
                {value}
              </span>
            );
          })}
      </div>
    </div>
  );
}
