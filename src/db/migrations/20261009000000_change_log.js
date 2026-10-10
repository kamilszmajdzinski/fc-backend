// Full change log for products and recipes: every create, update and delete, field by field.
// entity_id has no foreign key on purpose, so entries outlive the deleted product or recipe.
export async function up(knex) {
  await knex.schema.createTable('change_log', (table) => {
    table.increments('id');
    table.enu('entity_type', ['product', 'recipe']).notNullable();
    table.integer('entity_id').notNullable();
    table.string('entity_name', 200).notNullable();
    table.enu('action', ['created', 'updated', 'deleted']).notNullable();
    // JSON array of { field, from, to }.
    table.text('changes').notNullable();
    // The change that caused this one, e.g. a product price change that changed a recipe's food cost.
    table.integer('cause_change_id').references('id').inTable('change_log').onDelete('SET NULL');
    table.timestamp('changed_at').notNullable().defaultTo(knex.fn.now());
    table.index(['entity_type', 'entity_id']);
    table.index('cause_change_id');
  });
}

export async function down(knex) {
  await knex.schema.dropTable('change_log');
}
