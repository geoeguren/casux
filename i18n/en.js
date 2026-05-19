/**
 * i18n/en.js — English
 */
window.I18N_EN = {

  // ── Home screen ─────────────────────────────────────────────
  home_placeholder:        'What map shall we make today?',

  // ── Chat ────────────────────────────────────────────────────
  chat_placeholder:        'Describe the map...',
  chat_disclaimer:         'Casux can make mistakes. Accuracy, currency and availability of geographic data are the responsibility of each official source.',
  chat_login_required:     'Sign in to start creating your maps.',
  chat_login_prompt:       'To save your maps and access your history, you\'ll need to sign in. It\'s quick with Google!',
  chat_login_btn:          'Continue with Google',
  chat_show_more:          'Show more',
  chat_show_less:          'Show less',

  // ── Search ──────────────────────────────────────────────────
  search_placeholder:      'Search chats...',
  search_login_required:   'Sign in to search your maps.',

  // ── Map — topbar ─────────────────────────────────────────────
  map_title_placeholder:   'Map title',
  map_title_untitled:      'Untitled',
  map_refresh:             'Refresh map',
  map_close:               'Close map',
  map_export:              'Export',
  map_zoom_reset:          'Return to original view',
  map_layers:              'Layers',
  map_labels:              'Labels',
  map_identify:            'Enable element query',
  map_identify_off:        'Disable element query',
  map_scroll_bottom:       'Go to bottom',

  // ── Legend ──────────────────────────────────────────────────
  legend_title:            'Legend',
  legend_source:           'Source',
  legend_expand:           'Expand',
  legend_collapse:         'Collapse',
  legend_name_edit:        'Click to edit',

  // ── Layers panel ─────────────────────────────────────────────
  layers_panel_title:      'Layers',
  layers_panel_layers:     'Layers',
  layers_basemap:          'Base map',
  layers_edit:             'Edit layer',
  layers_center:           'Center view on layer',
  layers_advanced:         'Advanced edit',
  layers_advanced_mobile:  'Not available on mobile.',
  layers_delete_success:   'Layer deleted.',
  layers_name_edit:        'Click to edit',

  // ── Advanced edit modal ──────────────────────────────────────
  adv_single:              'Single symbol',
  adv_categorized:         'Categorized',
  adv_graduated:           'Graduated',
  adv_heatmap:             'Heat map',
  adv_coming_soon:         'Coming soon',
  adv_accept:              'Accept',
  adv_cancel:              'Cancel',
  adv_clear:               'Clear classification',
  adv_field:               'Field',
  adv_ramp:                'Color ramp',
  adv_classes:             'Classes',
  adv_none_selected:       'None selected',
  adv_all_disabled:        'All fields have more than {n} unique values and cannot be classified.',
  adv_drag_reorder:        'Drag to reorder',
  adv_ramp_invert:         'Invert color ramp',
  adv_delete_category:     'Delete category',
  adv_edit_style:          'Edit style',

  // ── SVG symbol (Maki) ────────────────────────────────────────
  adv_svg_title:           'SVG symbol',
  adv_svg_placeholder:     'hospital, airport, park…',
  adv_svg_no_results:      'No results for "{q}"',
  adv_svg_remove:          'Remove icon',
  adv_svg_icon_color:      'Icon color',

  // ── Simple style ─────────────────────────────────────────────
  style_geometry:          'Geometry',
  style_size:              'Size',
  style_border_weight:     'Border width',
  style_border_color:      'Border color',
  style_fill_color:        'Fill color',
  style_color:             'Color',
  style_opacity:           'Opacity',
  style_weight:            'Width',
  style_dash:              'Line pattern',
  style_dash:              'Line style',

  // ── Popup ────────────────────────────────────────────────────
  popup_center:            'Center view on this element',

  // ── Export ──────────────────────────────────────────────────
  export_geojson:          'Vector layer',
  export_jpeg:             'Image',
  export_pdf:              'Portable file',
  export_html:             'Embedded',
  export_loading_jpeg:     'Generating image (jpeg)…',
  export_loading_pdf:      'Generating portable file (pdf)…',
  export_done_jpeg:        'Image (jpeg) generated successfully.',
  export_done_pdf:         'Portable file (pdf) generated successfully.',
  export_done_html:        'HTML file generated successfully.',
  export_done_geojson:     'Vector layer (geojson) generated successfully.',
  export_area_too_large:   "The area you're trying to export is too large. Zoom in and try again.",
  export_jpeg_mobile_unsupported: 'Image (jpeg) export is not available on mobile devices. Use portable file (pdf) export or open Casux from a desktop browser.',
  export_error_jpeg:       'Error generating image (jpeg): {msg}.',
  export_error_pdf:        'Error generating portable file (pdf): {msg}.',
  export_pdf_too_many_features: 'The map has {n} features (max. {max} for pdf). Reduce active layers and try again.',
  export_error_html:       'Error generating HTML code.',
  export_no_layers:        'There are no layers to export.',
  export_no_map:           'There is no active map.',
  export_exporting:        'Exporting as {fmt}…',
  export_done:             '{fmt} exported.',
  export_error:            'Error exporting {fmt}.',

  // ── General toasts ───────────────────────────────────────────
  toast_name_error:        'Error updating the name.',
  toast_save_error:        'Could not save. Check your connection.',
  toast_map_no_layers:     'The map is empty.',
  toast_timeout_area:      'The operation timed out. Try with a smaller area.',
  toast_layer_error:       '{titulo} did not respond.',
  toast_layers_error:      '{n} layers did not respond.',
  toast_n_2: 'Two',
  toast_n_3: 'Three',
  toast_n_4: 'Four',
  toast_n_5: 'Five',
  toast_n_many: 'Several',
  toast_auth_error:        'Authentication error: {msg}.',
  toast_cache_warning:     'No server connection. Using cached data.',
  toast_server_unavailable: '{org} server is unavailable. Please try again in a few minutes.',
  toast_layer_fetch_error:  'Could not fetch "{typename}": {msg}.',
  toast_layer_truncated:    '{titulo} is too large to load without a filter. Try specifying a department or region.',

  // ── Clip toasts ──────────────────────────────────────────────
  toast_display_limit:     '{titulo} has {n} elements — too many to display.',
  toast_spatial_none:      '{titulo} cannot be clipped. Showing the full layer.',
  toast_spatial_limit:     '{titulo} has {n} elements — showing full layer without clipping.',
  toast_spatial_fallback:  'Server took too long. Processing on device…',

  // ── Sidebar / Auth ───────────────────────────────────────────
  toast_auth_login_error:  'Error signing in.',
  toast_chats_load_error:  'Could not load chats.',
  toast_chat_load_error:   'Could not load chat.',
  toast_chat_rename_error: 'Error renaming chat.',
  toast_chat_deleted:      'Map deleted.',
  toast_chat_delete_error: 'Error deleting chat.',

  // ── Chat header ──────────────────────────────────────────────
  chat_rename_error:       'Error renaming chat.',
  chat_deleted:            'Chat deleted.',
  chat_delete_error:       'Error deleting chat.',

  // ── Acciones ──────────────────────────────────────────────
  chat_delete:                   'Delete chat',
  chat_delete_confirm_title:     'Delete chat',
  chat_delete_confirm_body:      'Are you sure you want to delete this chat? This action cannot be undone.',
  chat_delete_confirm_cancel:    'Cancel',
  chat_delete_confirm_ok:        'Delete',
  chat_send:                   'Send',


  // ── Greetings ────────────────────────────────────────────────
  greeting_morning_1:      'Every map hides something.',
  greeting_morning_2:      'Another map to build.',
  greeting_morning_3:      'Everything is in the map.',
  greeting_morning_4:      "Let\'s begin.",
  greeting_morning_5:      'What map are we making?',
  greeting_afternoon_1:    'Every map hides something.',
  greeting_afternoon_2:    'Another map to build.',
  greeting_afternoon_3:    'What map are we making?',
  greeting_afternoon_4:    'Everything is in the map.',
  greeting_night_1:        'Every map hides something.',
  greeting_night_2:        'Another map to build.',
  greeting_night_3:        'The best maps are made at night.',
  greeting_night_4:        'Everything is in the map.',
  greeting_morning_n:      '{n}.',
  greeting_afternoon_n:    '{n}.',
  greeting_night_n:        '{n}.',
  greeting_hello_n:        '{n}. What map are we making?',
  greeting_hello_well_n:   '{n}. Every map hides something.',
  greeting_explore_n:      '{n}. Another map to build.',
  greeting_night_owl_n:    '{n}. The best maps are made at night.',
  greeting_nologin_1:      'Sign in to save what you explore.',
  greeting_nologin_2:      'Every map hides something.',
  greeting_nologin_3:      'Everything is in the map.',
  greeting_nologin_4:      'Another map to build.',

  // ── Sidebar ───────────────────────────────────────────────────
  sidebar_menu:            'Menu',
  sidebar_new_map:         'New map',
  sidebar_search:          'Search',
  sidebar_recent:          'Recent',
  sidebar_no_chats:        'No chats yet',
  sidebar_load_more:       'Load more',
  sidebar_untitled:        'Untitled',

  // ── Settings ─────────────────────────────────────────────────
  settings_appearance:     'Appearance',
  settings_system:         'System',
  settings_light:          'Light',
  settings_dark:           'Dark',
  settings_language:       'Language',
  settings_ai_model:       'AI model',
  settings_response_style: 'Mode',
  settings_default:        'Default',
  settings_efficient:      'Efficient',
  settings_detailed:       'Detailed',
  settings_creative:       'Creative',
  settings_logout:         'Sign out',

  // ── Export dropdown ──────────────────────────────────────────
  export_btn_label:        'EXPORT',
  export_opt_geojson:      'Vector layer',
  export_opt_jpeg:         'Image',
  export_opt_pdf:          'Portable file',
  export_opt_html:         'Embedded',
  export_opt_graphic:  'Graphic output',
  export_hint_graphic:     'jpeg · pdf',
  export_hint_html:        'html',
  export_hint_geojson:     'geojson',

  // ── Export HTML modal ────────────────────────────────────────
  html_modal_title:        'Embedded',
  html_basemap:            'Base map',
  html_layers:             'Layers',
  html_layers_none:        'None selected',
  html_identify:           'Element query',
  html_show_legend:        'Show legend',
  html_allow_zoom:         'Allow zoom',
  html_code:               'Code',
  html_copied:             'Copied',
  html_layers_selected:    '{n} layer{s} selected',
  html_code_placeholder:   '// Select layers to generate the code',
  html_code_error:         '// Error generating code: {msg}',

  // ── Graphic output modal ─────────────────────────────────────
  graphic_modal_title:     'Graphic output',
  graphic_basemap:         'Base map',
  graphic_interface:       'Interface',
  graphic_loc_map:         'Location map',
  graphic_grilla:          'Coordinate grid',
  graphic_north:           'North arrow',
  graphic_legend_pos:      'Legend position',
  graphic_pos_auto:        'Automatic',
  graphic_pos_tl:          'Top left',
  graphic_pos_tc:      'Top center',
  graphic_pos_ml:      'Middle left',
  graphic_pos_mr:      'Middle right',
  graphic_pos_tr:          'Top right',
  graphic_pos_bl:          'Bottom left',
  graphic_pos_bc:          'Bottom center',
  graphic_pos_br:          'Bottom right',
  graphic_formato:         'Format',
  graphic_download:        'Download',
  html_download:           'Download',
  html_interface:          'Interface',
  html_complex_hint:       'Some layers cannot be embedded due to their geometric complexity.',

  // ── Layers panel ─────────────────────────────────────────────
  shape_circle:            'Circle',
  shape_square:            'Square',
  layers_delete_layer:     'Delete layer',
  layers_delete_value:     'Delete',

  // ── Advanced modal — style ───────────────────────────────────
  adv_size:                'Size',
  adv_weight:              'Width',
  adv_opacity:             'Opacity',
  adv_border_color:        'Border color',
  adv_fill_color:          'Fill color',
  adv_color:               'Color',
  adv_line_pattern:        'Line pattern',
  adv_classes:             'Classes',

  // ── Style buttons ─────────────────────────────────────────────
  style_what_to_change:    'What would you like to change?',
  style_ask_color:         'What color would you like?',
  style_ask_size:          'What size would you like?',
  style_ask_weight:        'What thickness would you like?',
  style_ask_icon:          'Which icon would you like to use?',
  style_ask_geom:          'Which shape would you like to use?',
  style_change_size:       'Change size',
  style_change_color_point:'Change color',
  style_change_icon:       'Change icon',
  style_change_weight:     'Change thickness',
  style_change_color_line: 'Change color',
  style_change_fill:       'Change fill color',
  style_change_border:     'Change border color',
  style_applied:           'Done, applied.',
  style_confirm:           'Confirm',
  style_opening_editor:    'Opening the layer editor.',
  style_other:             'Other',

  // ── Intents ───────────────────────────────────────────────────
  export_choose_format:    'What format would you like to export?',
  basemap_choose:          'Which background map would you like to use?',
  basemap_changed:         'Done, I changed the background map.',
  map_drawing:             'Drawing…',
  map_cleared:             'Done, I cleared the map.',
  map_card_btn_ver:          'VIEW',
  map_card_default_title:    'Map',
  layer_already_on_map:      'That layer is already on the map.',
  layer_not_found:           'That layer is not on the map.',
  layer_removed:             'Done, removed {titulo}.',
  chat_renamed:            'Renamed the map to "{nombre}".',

  // ── Basemaps ─────────────────────────────────────────────────
  basemap_gray:            'Positron',
  basemap_dark:            'Dark Matter',
  basemap_voyager:         'Voyager',
  basemap_hint_gray:       'light',
  basemap_hint_dark:       'dark',
  basemap_hint_voyager:    'color',

  // ── Identify / popup ─────────────────────────────────────────
  identify_on:             'Query elements',
  identify_off:            'Deactivate query',
  popup_more_fields:       'More fields',

  // ── Color palettes ───────────────────────────────────────────
  palette_tierra:          'earth',
  palette_vivida:          'vivid',
  palette_azules:          'blues',
  palette_verdes:          'greens',
  palette_naranjas:        'oranges',
  palette_purpuras:        'purples',
  palette_rojo_amarillo:   'red-yellow',
  palette_teal:            'teal',
  palette_cualitativa:     'qualitative',
  palette_rojo_azul:       'red → blue',
  palette_marron_verde:    'brown → green',


  // ── Tooltips adicionais ────────────────────────────────────
  tooltip_refresh:         'Refresh',
  tooltip_back_chat:       'Close map',
  tooltip_delete_layer:  'Delete layer',
  tooltip_edit_style:  'Edit style',


  // ── Modal avançado — títulos e avisos ──────────────────────
  adv_modal_title:  'Advanced edit',
  adv_no_fields:        'This layer has no classifiable fields.',
  adv_simple_note:      'Simple style is edited directly in the layers panel.',
  adv_no_numeric_fields:  'This layer has no numeric fields.',

  // Mode selector
  mode_selector_prompt:  'How would you like Casux to respond?',
  mode_sub_default:      'Balanced with context',
  mode_sub_eficiente:    'Direct, no questions',
  mode_sub_detallista:   'Detailed with sources',
  mode_sub_creativo:      'Exploratory and conceptual',
  mode_chosen:           '{mode} mode activated. You can change it anytime in the menu.',


  sidebar_anon_label:    'Local session',
  sidebar_anon_sync:     'Sync with Google',
};
