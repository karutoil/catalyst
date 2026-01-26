import type { Template } from '../../types/template';
import EmptyState from '../shared/EmptyState';
import TemplateCard from './TemplateCard';

type Props = {
  templates: Template[];
};

function TemplateList({ templates }: Props) {
  if (!templates.length) {
    return (
      <EmptyState
        title="No templates"
        description="Create a template to bootstrap new game servers quickly."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {templates.map((template) => (
        <TemplateCard key={template.id} template={template} />
      ))}
    </div>
  );
}

export default TemplateList;
