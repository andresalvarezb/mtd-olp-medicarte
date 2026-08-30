export interface FlowStepData {
  title: string;
  description: string;
  highlight?: boolean;
  logistics?: boolean;
}

export function Flow({ steps }: { steps: FlowStepData[] }) {
  return (
    <div className="flow">
      {steps.map((step, index) => (
        <div
          key={step.title}
          className={`flow-step${step.highlight ? ' highlight' : ''}${step.logistics ? ' logistics' : ''}`}
        >
          <div className="num">{index + 1}</div>
          <strong>{step.title}</strong>
          <span>{step.description}</span>
        </div>
      ))}
    </div>
  );
}
