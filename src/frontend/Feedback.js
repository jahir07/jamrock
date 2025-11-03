(function ($) {
  "use strict";

  /**
   * Handle form submission via AJAX.
   */
  $(document).on("click", '.feedback-form button[type="button"]', function (e) {
    e.preventDefault();

    const $form = $(this).closest(".feedback-form");
    $form.addClass("current-form");

    const fields = {
      first_name: $form.find(".inputFirstName").val().trim(),
      last_name: $form.find(".inputLastName").val().trim(),
      email: $form.find(".inputEmail").val().trim(),
      subject: $form.find(".inputSubject").val().trim(),
      message: $form.find(".inputMessage").val().trim(),
    };

    // Simple validation loop
    let hasError = false;
    Object.entries(fields).forEach(([key, value]) => {
      const $input = $form.find(
        `.input${key.charAt(0).toUpperCase() + key.slice(1)}`
      );
      const $alert = $input.siblings(".alert-msg");

      if (!value) {
        $alert.text(`${key.replace("_", " ")} is required`);
        hasError = true;
      } else {
        $alert.empty();
      }
    });

    if (hasError) {
      return;
    }

    $.ajax({
      type: "POST",
      url: jamrock_loc.ajax_url,
      data: {
        data: $form.serialize(),
        nonce: jamrock_loc.nonce,
        action: "jamrock_form_action",
      },
      success: function (response) {
        const messageClass =
          response.status === "success" ? "text-success" : "text-danger";
        $form
          .closest(".current-form")
          .parent()
          .html(`<h3 class="${messageClass}">${response.message}</h3>`);
      },
      error: function () {
        $form
          .find(".alert-msg")
          .text("Something went wrong. Please try again.");
      },
    });
  });

  /**
   * Load paginated result list via AJAX.
   * @param {number} page - Page number
   */
  function loadAjaxResult(page) {
    const items = $("#load-lists").data("items");

    $.ajax({
      type: "GET",
      url: jamrock_loc.ajax_url,
      data: {
        page_no: page,
        list_per_page: items,
        action: "jamrock_result_action",
        nonce: jamrock_loc.nonce,
      },
      success: function (response) {
        $("#load-lists").html(response);
      },
    });
  }

  // Initial result load
  if ($('.jamrock-feedback-results').length) {
    const urlParams = new URLSearchParams(window.location.search);
    const currentPage = urlParams.get("cpage") || 1;
    loadAjaxResult(currentPage);
  }

  /**
   * Load result details by ID.
   */
  $(document).on("click", ".jrj-view-result", function (e) {
    e.preventDefault();

    const id = $(this).data("id");

    $.ajax({
      type: "GET",
      url: jamrock_loc.ajax_url,
      data: {
        id: id,
        action: "jamrock_result_by_id_action",
        nonce: jamrock_loc.nonce,
      },
      success: function (response) {
        $(".details-block").html(response);
      },
    });
  });

  /**
   * Handle pagination clicks via AJAX.
   */
  $(document).on("click", ".pagination .page-numbers", function (e) {
    e.preventDefault();

    const pageSlug = $(this).attr("href");
    const pageNumberMatch = pageSlug ? pageSlug.match(/\d+/) : null;
    const items = $("#load-lists").data("items");

    if (!pageNumberMatch) {
      return;
    }

    const pageNumber = pageNumberMatch[0];

    $.ajax({
      type: "POST",
      url: jamrock_loc.ajax_url,
      data: {
        page_no: pageNumber,
        list_per_page: items,
        action: "jamrock_pagination_action",
        nonce: jamrock_loc.nonce,
      },
      success: function (response) {
        // Update URL
        window.history.pushState({}, "", pageSlug);

        if (response.success) {
          // Replace list and pagination with server-rendered markup
          $("#load-lists").html(response.data.list_html);
          $(".pagination").html(response.data.pagination);
        } else {
          console.error("Pagination failed:", response);
        }
      },
    });
  });
})(jQuery);
