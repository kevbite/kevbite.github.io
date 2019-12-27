
document.addEventListener("DOMContentLoaded", function () {
    var toggle = document.querySelector(".toggle");
    var toggleIcon = toggle.getElementsByTagName("i")[0];

    toggle.addEventListener("click", function () {
        var items = document.querySelectorAll("nav .item");

        toggleIcon.classList.remove("fa-bars");
        toggleIcon.classList.remove("fa-times");

        if (items[0].classList.contains("active")) {
            for (var i = 0; i < items.length; i++) {
                items[i].classList.remove("active");
            }
            toggleIcon.classList.add("fa-bars");
        } else {
            for (var i = 0; i < items.length; i++) {
                items[i].classList.add("active");
            }
            toggleIcon.classList.add("fa-times");
        }
    }, false);

});