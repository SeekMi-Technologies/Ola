import CrudModule from '@/modules/CrudModule/CrudModule';
import DynamicForm from '@/forms/DynamicForm';
import { fields } from './config';
import EntityTrail from '@/components/EntityTrail';

import useLanguage from '@/locale/useLanguage';

export default function Merchandise() {
    const translate = useLanguage();
    const entity = 'merch';
    const searchConfig = {
        displayLabels: ['serialNumber'],
        searchFields: 'serialNumber'
    };
    const deleteModalLabels = ['serialNumber'];

    const Labels = {
        PANEL_TITLE: translate('merch'),
        DATATABLE_TITLE: translate('merch_list'),
        ADD_NEW_ENTITY: translate('add_new_merch'),
        ENTITY_NAME: translate('merch'),
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
            extraReadContent={<EntityTrail entityType="Merch" />}
        />
    );
}

