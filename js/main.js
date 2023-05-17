$(document).ready(function () {


  var browserName = (function (agent) {
    switch (true) {
      case agent.indexOf("edge") > -1: return "Edge";
      case agent.indexOf("edg/") > -1: return "Edge"; // Match also / to avoid matching for the older Edge
      case agent.indexOf("opr") > -1 && !!window.opr: return "Opera";
      case agent.indexOf("chrome") > -1 && !!window.chrome: return "Chrome";
      case agent.indexOf("trident") > -1: return "ie";
      case agent.indexOf("firefox") > -1: return "Firefox";
      case agent.indexOf("safari") > -1: return "Safari";
      default: return "other";
    }
  })(window.navigator.userAgent.toLowerCase());
  var original;

  var openInTab = function (url) {
    window.open(url, '_blank');
    window.open(url);
  }

  $("#logo.subpage").mouseover(function () {
    original = $(this).attr('src');
    $(this).attr('src', 'img/adn_animated_croped.png');
  });

  $("#logo.subpage").mouseout(function () {
    $(this).attr('src', original);
  });

  // show the correct default install link (see #295)
  $("#install a").addClass('passive');

  if (typeof bowser !== 'undefined') { // not for press page 
    console.log("browserName", browserName)
    var sel = $("#install" + browserName);
    if (!sel.length) sel = $("#installFirefox"); // firefox is default
    sel.removeClass('passive');

    switch (browserName) {
      case 'Edge':
        $("#installChrome").css('right', '0px');
        $("#installOpera").css('right', '40px');
        $("#installFirefox").css('right', '80px');
        break;
      case 'Firefox':
        $("#installChrome").css('right', '0px');
        $("#installOpera").css('right', '40px');
        $("#installEdge").css('right', '80px');
        break;
      case 'Chrome':
        $("#installFirefox").css('right', '0px');
        $("#installOpera").css('right', '40px');
        $("#installEdge").css('right', '80px');
        break;
      case 'Opera':
        $("#installFirefox").css('right', '0px');
        $("#installChrome").css('right', '40px');
        $("#installEdge").css('right', '80px');
        break;
      default:
        $("#installChrome").css('right', '0px');
        $("#installOpera").css('right', '40px');
        $("#installEdge").css('right', '80px');
        break;
    }
  }

  var bannedDate = new Date("Jan 1, 2017 00:00:00").getTime();

  // Update the count every 1 second
  setInterval(function count() {

    var now = new Date().getTime();
    var distance = now - bannedDate;

    var days = Math.floor(distance / (1000 * 60 * 60 * 24));
    var hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    var minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    var seconds = Math.floor((distance % (1000 * 60)) / 1000);

    if (hours < 10) hours = "0" + hours;
    if (minutes < 10) minutes = "0" + minutes;
    if (seconds < 10) seconds = "0" + seconds;

    // Display the result in the element with id="demo"
    $(".countdown .days").text(days);
    $(".countdown .hours").text(hours);
    $(".countdown .mins").text(minutes);
    $(".countdown .secs").text(seconds);

    return count;

  }(), 1000);

});
