"use client";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface DataPoint {
  trial: number;
  fitness: number;
  quality: number;
}

export function FitnessChart({ data }: { data: DataPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="trial" label={{ value: "Trial", position: "insideBottom", offset: -2 }} tick={{ fontSize: 12 }} />
        <YAxis domain={[0, 1]} tick={{ fontSize: 12 }} />
        <Tooltip />
        <Line type="monotone" dataKey="fitness" stroke="#6366f1" dot={false} strokeWidth={2} />
        <Line type="monotone" dataKey="quality" stroke="#94a3b8" dot={false} strokeDasharray="4 4" />
      </LineChart>
    </ResponsiveContainer>
  );
}
