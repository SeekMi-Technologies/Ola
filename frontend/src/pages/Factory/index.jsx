import CrudModule from '@/modules/CrudModule/CrudModule';
import DynamicForm from '@/forms/DynamicForm';
import { fields } from './config';
import EntityTrail from '@/components/EntityTrail';

import useLanguage from '@/locale/useLanguage';


export default function Factory() {
  const translate = useLanguage();
  const entity = 'factory';
  const searchConfig = {
    displayLabels: ['factory_code'],
    searchFields: 'factory_code',
  };
  const deleteModalLabels = ['factory_code'];


  const Labels = {
    PANEL_TITLE: translate('factory'),
    DATATABLE_TITLE: translate('factory_list'),
    ADD_NEW_ENTITY: translate('add_new_factory'),
    ENTITY_NAME: translate('factory'),
  };

  const configPage = {
    entity,
    ...Labels,
  };

  const config = {
    ...configPage,
    fields,
    searchConfig,
    deleteModalLabels,
  };

  return (  
    <CrudModule
      createForm={<DynamicForm fields={fields} isUpdateForm={true} />}
      updateForm={<DynamicForm fields={fields} isUpdateForm={true} />}
      config={config}
      extraReadContent={<EntityTrail entityType="Factory" />}
    />
  );
}



