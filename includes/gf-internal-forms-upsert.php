<?php
defined('ABSPATH') || exit;

/**
 * Bootstrap hooks for internal PHYSICAL form (same pattern you can copy for Skills/Medical).
 */
add_action('init', function () {
    // Pick form id from option or fallback to 2
    $fid = (int) get_option('jrj_form_physical_id', 0) ?: 2;

    // Prefill before render + keep values during validation step
    add_filter("gform_pre_render_{$fid}", 'jrj_phys_prefill', 10, 1);
    add_filter("gform_pre_validation_{$fid}", 'jrj_phys_prefill', 10, 1);

    // Upsert: update existing entry (by applicant_email) instead of creating a new one
    add_filter("gform_entry_id_pre_save_{$fid}", 'jrj_phys_upsert', 10, 3);

    // Optional: if you didn't set "Allow field to be populated dynamically" for hidden applicant_id
    add_filter("gform_pre_render_{$fid}", 'jrj_phys_set_hidden_id_from_get', 9, 1);
});

/**
 * Prefill fields from the last entry for this applicant_email.
 */
function jrj_phys_prefill($form)
{
    $email = isset($_GET['applicant_email']) ? sanitize_email($_GET['applicant_email']) : '';
    if (!$email || !class_exists('\GFAPI')) {
        return $form;
    }

    // Find field id for applicant_email (fallback '2')
    $emailFieldId = jrj_find_field_id($form, 'applicant_email') ?: '2';

    // Fetch the latest entry for this email
    $search = array(
        'status' => 'active',
        'field_filters' => array(
            'mode' => 'all',
            array('key' => $emailFieldId, 'value' => $email),
        ),
    );
    $sorting = array('key' => 'id', 'direction' => 'DESC');
    $paging = array('page_size' => 1, 'offset' => 0);

    $entries = \GFAPI::get_entries((int) $form['id'], $search, $sorting, $paging);
    if (is_wp_error($entries) || empty($entries)) {
        return $form;
    }
    $e = $entries[0];

    // Push entry values into field defaultValue so recruiter sees previous data
    foreach ($form['fields'] as &$f) {
        $id = (string) $f->id;

        // simple fields
        if (isset($e[$id]) && $e[$id] !== '') {
            $f->defaultValue = $e[$id];
        }

        // checkbox/radio with inputs (like 8.1, 8.2…)
        if (!empty($f->inputs) && is_array($f->inputs)) {
            foreach ($f->inputs as &$input) {
                $key = (string) $input['id'];
                if (isset($e[$key]) && $e[$key] !== '') {
                    $input['defaultValue'] = $e[$key];
                }
            }
        }
    }
    unset($f);

    return $form;
}

/**
 * Upsert: if an entry exists for this email, return its id so GF updates it.
 */
function jrj_phys_upsert($entry_id, $form, $entry)
{
    $emailFieldId = jrj_find_field_id($form, 'applicant_email') ?: '2';
    $email = rgar($entry, $emailFieldId);
    if (!is_email($email)) {
        return $entry_id; // do nothing
    }

    $search = array(
        'status' => 'active',
        'field_filters' => array(
            'mode' => 'all',
            array('key' => $emailFieldId, 'value' => $email),
        ),
    );
    $sorting = array('key' => 'id', 'direction' => 'DESC');
    $paging = array('page_size' => 1, 'offset' => 0);

    $found = \GFAPI::get_entries((int) $form['id'], $search, $sorting, $paging);
    if (!is_wp_error($found) && !empty($found)) {
        return (int) $found[0]['id']; // ✅ tells GF to update this entry
    }
    return $entry_id; // no existing entry, proceed to create new
}

/**
 * Ensure hidden applicant_id gets value from URL even if dynamic population wasn't enabled.
 */
function jrj_phys_set_hidden_id_from_get($form)
{
    $aid = isset($_GET['applicant_id']) ? sanitize_text_field($_GET['applicant_id']) : '';
    if (!$aid) {
        return $form;
    }
    $fieldId = jrj_find_field_id($form, 'applicant_id') ?: '1';
    foreach ($form['fields'] as &$f) {
        if ((string) $f->id === (string) $fieldId) {
            $f->defaultValue = $aid;
            break;
        }
    }
    unset($f);
    return $form;
}

/**
 * Utility: find a field id by inputName (Parameter Name).
 */
function jrj_find_field_id($form, $inputName)
{
    if (!empty($form['fields'])) {
        foreach ($form['fields'] as $f) {
            if (isset($f->inputName) && $f->inputName === $inputName) {
                return (string) $f->id;
            }
        }
    }
    return null;
}