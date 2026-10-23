'use strict';
const params = new URLSearchParams(location.search);
const reason = params.get('reason');
const title = document.getElementById('promo-title');
const message = document.getElementById('promo-message');
const reasonText = document.getElementById('promo-reason');
if (reason === 'expired') {
  title.textContent = 'This dynamic QR has expired';
  message.textContent = 'The 24-hour period for this dynamic QR has ended. You can create a new one in Kirameki.';
  reasonText.textContent = 'This QR link expired after its 24-hour lifetime. The original destination is no longer opened.';
} else if (reason === 'paused') {
  title.textContent = 'This dynamic QR is paused';
  message.textContent = 'The owner paused this QR link. Explore Kirameki to create and manage your own links.';
  reasonText.textContent = 'The owner paused this dynamic QR link. Its destination is not currently available.';
} else if (reason === 'deleted') {
  title.textContent = 'This dynamic QR is no longer available';
  message.textContent = 'This QR link was removed by its owner. Create your own link or QR code with Kirameki.';
  reasonText.textContent = 'The owner deleted this dynamic QR. The original destination is no longer opened.';
}
