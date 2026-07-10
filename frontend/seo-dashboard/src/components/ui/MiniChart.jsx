import { LineChart, Line, ResponsiveContainer, Tooltip, Area, AreaChart, BarChart, Bar, XAxis, YAxis } from 'recharts';

export function SparkLine({ data, color = 'var(--accent)', height = 48 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <defs>
          <linearGradient id={`grad-${color.replace(/[^a-z0-9]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#grad-${color.replace(/[^a-z0-9]/gi, '')})`} dot={false} />
        <Tooltip
          contentStyle={{ background: 'var(--text-primary)', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 12, color: '#fff' }}
          itemStyle={{ color: '#fff' }}
          labelStyle={{ display: 'none' }}
          formatter={(v) => [v.toFixed(2)]}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function BarChartComp({ data, color = 'var(--accent)', height = 160, xKey = 'date', valueKey = 'value' }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 0 }} barSize={20}>
        <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
        <YAxis hide />
        <Tooltip
          contentStyle={{ background: 'var(--text-primary)', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 12, color: '#fff' }}
          itemStyle={{ color: '#fff' }}
          cursor={{ fill: 'rgba(0,0,0,0.04)' }}
        />
        <Bar dataKey={valueKey} fill={color} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LineChartComp({ data, lines, height = 200 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
        <YAxis hide />
        <Tooltip
          contentStyle={{ background: 'var(--text-primary)', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, color: '#fff' }}
          itemStyle={{ color: '#fff' }}
          cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
        />
        {lines.map(line => (
          <Line key={line.key} type="monotone" dataKey={line.key} stroke={line.color} strokeWidth={2} dot={false} name={line.label} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
